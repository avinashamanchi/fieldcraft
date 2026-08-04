import { getSupabaseClient } from '../auth/supabase'
import type { EntityName, MutationEnvelope } from '../domain/sync'
import type { CloudRowEnvelope, InvoiceBundlePayload } from './repository'
import {
  RemoteGatewayError,
  type PullResult,
  type PushResult,
  type RealtimeSubscription,
  type RemoteGateway,
} from './remoteGateway'

type ProviderReply = {
  data: unknown
  error: unknown | null
  status?: number
}

type QueryLike = {
  select(columns?: string): QueryLike
  eq(column: string, value: string): QueryLike
  gte(column: string, value: string): QueryLike
  order(column: string, options?: { ascending?: boolean }): QueryLike
  limit(count: number): PromiseLike<ProviderReply>
  abortSignal?(signal: AbortSignal): QueryLike
}

type ChannelLike = {
  on(
    event: 'postgres_changes',
    filter: Record<string, string>,
    callback: () => void,
  ): ChannelLike
  subscribe(callback?: (status: string) => void): ChannelLike
  unsubscribe(): unknown
}

export type SupabaseGatewayClient = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<ProviderReply>
  from(table: string): QueryLike
  channel(name: string): ChannelLike
}

type RawRecord = Record<string, unknown>

type CursorTuple = {
  updatedAt: string
  id: string
}

const PULL_LIMIT = 500
const TABLES: { entity: EntityName; table: string; ownerColumn: 'id' | 'user_id' }[] = [
  { entity: 'profile', table: 'profiles', ownerColumn: 'id' },
  { entity: 'client', table: 'clients', ownerColumn: 'user_id' },
  { entity: 'job', table: 'jobs', ownerColumn: 'user_id' },
  { entity: 'invoice', table: 'invoices', ownerColumn: 'user_id' },
  { entity: 'expense', table: 'expenses', ownerColumn: 'user_id' },
  { entity: 'service', table: 'services', ownerColumn: 'user_id' },
  { entity: 'inventory', table: 'inventory_items', ownerColumn: 'user_id' },
]

const asRecord = (value: unknown): RawRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RemoteGatewayError('invalid-response')
  }
  return value as RawRecord
}

const requireString = (record: RawRecord, key: string): string => {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new RemoteGatewayError('invalid-response')
  }
  return value
}

const optionalString = (record: RawRecord, key: string): string | undefined => {
  const value = record[key]
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string') throw new RemoteGatewayError('invalid-response')
  return value
}

const requireInteger = (record: RawRecord, key: string): number => {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RemoteGatewayError('invalid-response')
  }
  return value
}

const decodeCursor = (cursor: string | null): CursorTuple | null => {
  if (cursor === null) return null
  try {
    const parsed = asRecord(JSON.parse(cursor))
    const updatedAt = requireString(parsed, 'updatedAt')
    const id = requireString(parsed, 'id')
    if (!Number.isFinite(Date.parse(updatedAt))) throw new RemoteGatewayError('invalid-response')
    return { updatedAt, id }
  } catch (error) {
    if (error instanceof RemoteGatewayError) throw error
    throw new RemoteGatewayError('invalid-response')
  }
}

const encodeCursor = (cursor: CursorTuple): string => JSON.stringify(cursor)

const compareCursor = (left: CursorTuple, right: CursorTuple): number =>
  left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id)

const mapProviderFailure = (reply: ProviderReply): void => {
  if (!reply.error && (reply.status === undefined || (reply.status >= 200 && reply.status < 300))) {
    return
  }
  const status = reply.status ?? 0
  if (status === 401) throw new RemoteGatewayError('reauthentication')
  if (status === 400) throw new RemoteGatewayError('validation')
  if (status === 0 || status >= 500) throw new RemoteGatewayError('transient')
  throw new RemoteGatewayError('invalid-response')
}

const callProvider = async (
  operation: () => PromiseLike<ProviderReply>,
  allowConflictBody = false,
): Promise<ProviderReply> => {
  try {
    const reply = await operation()
    if (allowConflictBody && reply.status === 409 && reply.data !== null) return reply
    mapProviderFailure(reply)
    return reply
  } catch (error) {
    if (error instanceof RemoteGatewayError) throw error
    throw new RemoteGatewayError('transient')
  }
}

const canonicalCommon = (
  entity: EntityName,
  raw: RawRecord,
  ownerId: string,
): {
  id: string
  ownerId: string
  version: number
  createdAt: string
  updatedAt: string
  syncState: 'current'
} => {
  const id = requireString(raw, 'id')
  const rawOwnerId = entity === 'profile' ? id : requireString(raw, 'user_id')
  if (rawOwnerId !== ownerId) throw new RemoteGatewayError('invalid-response')
  const createdAt = requireString(raw, 'created_at')
  const updatedAt = requireString(raw, 'updated_at')
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new RemoteGatewayError('invalid-response')
  }
  return {
    id,
    ownerId,
    version: requireInteger(raw, 'version'),
    createdAt,
    updatedAt,
    syncState: 'current',
  }
}

const lineItemsFromCloud = (value: unknown): RawRecord[] => {
  if (!Array.isArray(value)) throw new RemoteGatewayError('invalid-response')
  return value.map((item) => {
    const row = asRecord(item)
    const normalized: RawRecord = {
      description: requireString(row, 'description'),
      type: requireString(row, 'type'),
      quantity: requireInteger(row, 'quantity'),
      unitPriceCents: requireInteger(row, 'unitPriceCents'),
    }
    const id = optionalString(row, 'id')
    if (id) normalized.id = id
    return normalized
  })
}

const normalizePullPayload = (
  entity: EntityName,
  raw: RawRecord,
  ownerId: string,
  rowsByEntity: Map<EntityName, Map<string, RawRecord>>,
): Record<string, unknown> => {
  const common = canonicalCommon(entity, raw, ownerId)
  switch (entity) {
    case 'profile':
      return { ...common, businessName: requireString(raw, 'business_name') }
    case 'client':
      return { ...common, name: requireString(raw, 'name') }
    case 'job':
      return {
        ...common,
        clientId: requireString(raw, 'client_id'),
        title: requireString(raw, 'title'),
        status: requireString(raw, 'status'),
      }
    case 'invoice': {
      const clientId = requireString(raw, 'client_id')
      const jobId = optionalString(raw, 'job_id')
      const relatedClient = raw.clients === undefined || raw.clients === null
        ? undefined
        : asRecord(raw.clients)
      const relatedJob = raw.jobs === undefined || raw.jobs === null
        ? undefined
        : asRecord(raw.jobs)
      const client = rowsByEntity.get('client')?.get(clientId) ?? relatedClient
      const job = jobId ? rowsByEntity.get('job')?.get(jobId) ?? relatedJob : undefined
      if (!client) throw new RemoteGatewayError('invalid-response')
      return {
        ...common,
        clientId,
        ...(jobId ? { jobId } : {}),
        draft: {
          clientName: requireString(client, 'name'),
          jobTitle: job ? requireString(job, 'title') : requireString(raw, 'number'),
          ...(job && optionalString(job, 'address') ? { jobAddress: optionalString(job, 'address') } : {}),
          ...(job && optionalString(job, 'description') ? { jobDescription: optionalString(job, 'description') } : {}),
          tradeType: job ? requireString(job, 'trade_type') : 'General',
          taxBasisPoints: requireInteger(raw, 'tax_basis_points'),
          paymentTerms: requireString(raw, 'payment_terms'),
          lineItems: lineItemsFromCloud(raw.line_items),
          ...(optionalString(raw, 'notes') ? { notes: optionalString(raw, 'notes') } : {}),
        },
        subtotalCents: requireInteger(raw, 'subtotal_cents'),
        taxCents: requireInteger(raw, 'tax_cents'),
        totalCents: requireInteger(raw, 'total_cents'),
      }
    }
    case 'expense':
      return { ...common, amountCents: requireInteger(raw, 'amount_cents') }
    case 'service':
      return {
        ...common,
        name: requireString(raw, 'name'),
        unitPriceCents: requireInteger(raw, 'unit_price_cents'),
      }
    case 'inventory':
      return {
        ...common,
        name: requireString(raw, 'name'),
        unitPriceCents: requireInteger(raw, 'unit_price_cents'),
      }
  }
}

const normalizeWithLocalPayload = (
  entity: EntityName,
  rawValue: unknown,
  localValue: unknown,
  ownerId: string,
): CloudRowEnvelope => {
  const raw = asRecord(rawValue)
  const local = asRecord(localValue)
  const common = canonicalCommon(entity, raw, ownerId)
  return {
    ownerId,
    entity,
    entityId: common.id,
    payload: { ...local, ...common },
    version: common.version,
    updatedAt: common.updatedAt,
  }
}

const mutationRpcPayload = (mutation: MutationEnvelope): unknown => {
  if (mutation.kind !== 'save_invoice_bundle') return mutation.payload
  const bundle = mutation.payload as InvoiceBundlePayload
  const invoiceDraft = bundle.invoice.draft
  return {
    client: { ...bundle.client },
    job: { ...bundle.job, tradeType: invoiceDraft.tradeType },
    invoice: {
      ...bundle.invoice,
      number: (bundle.invoice as unknown as RawRecord).number ?? bundle.invoice.id,
      lineItems: invoiceDraft.lineItems,
      taxBasisPoints: invoiceDraft.taxBasisPoints,
      paymentTerms: invoiceDraft.paymentTerms,
      notes: invoiceDraft.notes,
      status: (bundle.invoice as unknown as RawRecord).status ?? 'Draft',
    },
  }
}

const parseConflict = (
  data: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  if (
    requireString(data, 'mutation_id') !== mutation.id ||
    requireString(data, 'entity') !== mutation.entity ||
    requireString(data, 'entity_id') !== mutation.entityId
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const cloudVersion = requireInteger(data, 'cloud_version')
  const cloudRow = normalizeWithLocalPayload(
    mutation.entity,
    data.cloud_payload,
    mutation.payload,
    ownerId,
  )
  if (cloudRow.version !== cloudVersion) throw new RemoteGatewayError('invalid-response')
  return {
    type: 'conflict',
    conflict: {
      mutationId: mutation.id,
      mutationKind: mutation.kind,
      entity: mutation.entity,
      entityId: mutation.entityId,
      localPayload: mutation.payload,
      cloudPayload: cloudRow.payload,
      cloudVersion,
    },
  }
}

const parseApplied = (
  data: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  if (mutation.kind === 'save_invoice_bundle') {
    const bundle = mutation.payload as InvoiceBundlePayload
    return {
      type: 'applied',
      rows: [
        normalizeWithLocalPayload('client', data.client, bundle.client, ownerId),
        normalizeWithLocalPayload('job', data.job, bundle.job, ownerId),
        normalizeWithLocalPayload('invoice', data.invoice, bundle.invoice, ownerId),
      ],
    }
  }
  if (
    requireString(data, 'entity') !== mutation.entity ||
    requireString(data, 'kind') !== mutation.kind ||
    requireString(data, 'entity_id') !== mutation.entityId
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  if (mutation.kind === 'delete') {
    const version = requireInteger(data, 'deleted_version')
    return {
      type: 'applied',
      rows: [{
        ownerId,
        entity: mutation.entity,
        entityId: mutation.entityId,
        payload: null,
        version,
        updatedAt: mutation.createdAt,
        deleted: true,
      }],
    }
  }
  return {
    type: 'applied',
    rows: [normalizeWithLocalPayload(mutation.entity, data.cloud, mutation.payload, ownerId)],
  }
}

const parsePushResponse = (
  value: unknown,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  const data = asRecord(value)
  const status = requireString(data, 'status')
  if (status === 'conflict') return parseConflict(data, mutation, ownerId)
  if (status === 'applied') return parseApplied(data, mutation, ownerId)
  throw new RemoteGatewayError('invalid-response')
}

export const createSupabaseGateway = (
  suppliedClient?: SupabaseGatewayClient,
): RemoteGateway => {
  const client = suppliedClient ?? getSupabaseClient() as unknown as SupabaseGatewayClient

  return {
    async pullSince(ownerId, cursorValue, signal): Promise<PullResult> {
      if (!ownerId || signal.aborted) throw new RemoteGatewayError('transient')
      const cursor = decodeCursor(cursorValue)
      const rawRows = await Promise.all(TABLES.map(async ({ entity, table, ownerColumn }) => {
        const selection = entity === 'invoice'
          ? '*, clients!invoices_owned_client_fkey(name), jobs!invoices_owned_job_fkey(title,address,description,trade_type)'
          : '*'
        let query = client
          .from(table)
          .select(selection)
          .eq(ownerColumn, ownerId)
        if (cursor) query = query.gte('updated_at', cursor.updatedAt)
        query = query.order('updated_at', { ascending: true }).order('id', { ascending: true })
        if (query.abortSignal) query = query.abortSignal(signal)
        const reply = await callProvider(() => query.limit(PULL_LIMIT))
        if (!Array.isArray(reply.data)) throw new RemoteGatewayError('invalid-response')
        return reply.data.map((value) => ({ entity, raw: asRecord(value) }))
      }))
      if (signal.aborted) throw new RemoteGatewayError('transient')

      const flattened = rawRows.flat()
      const rowsByEntity = new Map<EntityName, Map<string, RawRecord>>()
      for (const { entity, raw } of flattened) {
        const id = requireString(raw, 'id')
        const rows = rowsByEntity.get(entity) ?? new Map<string, RawRecord>()
        rows.set(id, raw)
        rowsByEntity.set(entity, rows)
      }

      const normalized = flattened.map(({ entity, raw }) => {
        if (raw.deleted === true) {
          const common = canonicalCommon(entity, raw, ownerId)
          return {
            ownerId,
            entity,
            entityId: common.id,
            payload: null,
            version: common.version,
            updatedAt: common.updatedAt,
            deleted: true,
          } satisfies CloudRowEnvelope
        }
        const payload = normalizePullPayload(entity, raw, ownerId, rowsByEntity)
        return {
          ownerId,
          entity,
          entityId: String(payload.id),
          payload,
          version: Number(payload.version),
          updatedAt: String(payload.updatedAt),
        } satisfies CloudRowEnvelope
      }).filter((row) => {
        if (!cursor) return true
        return compareCursor({ updatedAt: row.updatedAt, id: row.entityId }, cursor) > 0
      }).sort((left, right) => compareCursor(
        { updatedAt: left.updatedAt, id: left.entityId },
        { updatedAt: right.updatedAt, id: right.entityId },
      )).slice(0, PULL_LIMIT)

      const next = normalized.length > 0
        ? { updatedAt: normalized.at(-1)!.updatedAt, id: normalized.at(-1)!.entityId }
        : cursor ?? { updatedAt: '1970-01-01T00:00:00.000Z', id: '00000000-0000-0000-0000-000000000000' }
      return { rows: normalized, cursor: encodeCursor(next) }
    },

    async pushMutation(ownerId, mutation, signal): Promise<PushResult> {
      if (!ownerId || mutation.ownerId !== ownerId || signal.aborted) {
        throw new RemoteGatewayError('transient')
      }
      const reply = mutation.kind === 'save_invoice_bundle'
        ? await callProvider(() => client.rpc('save_invoice_bundle', {
            p_mutation_id: mutation.id,
            p_payload: mutationRpcPayload(mutation),
          }), true)
        : await callProvider(() => client.rpc('apply_entity_mutation', {
            p_mutation_id: mutation.id,
            p_entity: mutation.entity,
            p_kind: mutation.kind,
            p_entity_id: mutation.entityId,
            p_base_version: mutation.baseVersion,
            p_payload: mutation.kind === 'delete' ? {} : mutation.payload,
          }), true)
      if (signal.aborted) throw new RemoteGatewayError('transient')
      return parsePushResponse(reply.data, mutation, ownerId)
    },

    subscribeToOwner(ownerId, onInvalidation, onFailure): RealtimeSubscription {
      if (!ownerId) throw new RemoteGatewayError('invalid-response')
      let active = true
      let channel = client.channel(`fieldcraft-owner-${ownerId}`)
      for (const { table, ownerColumn } of TABLES) {
        channel = channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `${ownerColumn}=eq.${ownerId}`,
          },
          () => {
            if (active) onInvalidation()
          },
        )
      }
      channel.subscribe((status) => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) onFailure?.()
      })
      return {
        unsubscribe() {
          if (!active) return
          active = false
          void channel.unsubscribe()
        },
      }
    },
  }
}
