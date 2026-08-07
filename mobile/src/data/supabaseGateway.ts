import { getSupabaseClient } from '../auth/supabase'
import type { EntityName, MutationEnvelope } from '../domain/sync'
import type { CloudRowEnvelope, InvoiceBundlePayload } from './repository'
import { parsePostgresTimestamp } from './postgresTimestamp'
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
  channel(name: string): ChannelLike
}

export type SupabaseGatewayOptions = {
  deadlineMs?: number
}

type RawRecord = Record<string, unknown>

type CursorTuple = {
  updatedAt: string
  changeSeq: number
  changeId: number
}

const PULL_LIMIT = 500
const DEFAULT_DEADLINE_MS = 20_000
const TABLES: { table: string; ownerColumn: 'id' | 'user_id' }[] = [
  { table: 'profiles', ownerColumn: 'id' },
  { table: 'clients', ownerColumn: 'user_id' },
  { table: 'jobs', ownerColumn: 'user_id' },
  { table: 'invoices', ownerColumn: 'user_id' },
  { table: 'expenses', ownerColumn: 'user_id' },
  { table: 'services', ownerColumn: 'user_id' },
  { table: 'inventory_items', ownerColumn: 'user_id' },
]
const ENTITY_NAMES = new Set<EntityName>([
  'profile',
  'client',
  'job',
  'invoice',
  'expense',
  'service',
  'inventory',
])

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

const optionalInteger = (record: RawRecord, key: string, fallback = 0): number => {
  if (record[key] === undefined || record[key] === null) return fallback
  return requireInteger(record, key)
}

const requireBoolean = (record: RawRecord, key: string): boolean => {
  const value = record[key]
  if (typeof value !== 'boolean') throw new RemoteGatewayError('invalid-response')
  return value
}

const requireEntity = (record: RawRecord, key: string): EntityName => {
  const value = requireString(record, key) as EntityName
  if (!ENTITY_NAMES.has(value)) throw new RemoteGatewayError('invalid-response')
  return value
}

const requireTimestamp = (record: RawRecord, key: string): string => {
  const value = requireString(record, key)
  try {
    parsePostgresTimestamp(value)
  } catch {
    throw new RemoteGatewayError('invalid-response')
  }
  return value
}

const decodeCursor = (cursor: string | null): CursorTuple | null => {
  if (cursor === null) return null
  try {
    const parsed = asRecord(JSON.parse(cursor))
    return {
      updatedAt: requireTimestamp(parsed, 'updatedAt'),
      changeSeq: requireInteger(parsed, 'changeSeq'),
      changeId: requireInteger(parsed, 'changeId'),
    }
  } catch (error) {
    if (error instanceof RemoteGatewayError) throw error
    throw new RemoteGatewayError('invalid-response')
  }
}

const encodeCursor = (cursor: CursorTuple): string => JSON.stringify(cursor)

const cursorEquals = (left: CursorTuple, right: CursorTuple): boolean =>
  left.updatedAt === right.updatedAt &&
  left.changeSeq === right.changeSeq &&
  left.changeId === right.changeId

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
  signal: AbortSignal,
  deadlineMs: number,
  allowConflictBody = false,
): Promise<ProviderReply> => {
  if (signal.aborted) throw new RemoteGatewayError('transient')
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new RemoteGatewayError('transient')), deadlineMs)
  })
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new RemoteGatewayError('transient'))
    signal.addEventListener('abort', abort, { once: true })
  })
  try {
    const reply = await Promise.race([
      Promise.resolve().then(operation),
      deadline,
      cancellation,
    ])
    if (allowConflictBody && reply.status === 409 && reply.data !== null) return reply
    mapProviderFailure(reply)
    return reply
  } catch (error) {
    if (error instanceof RemoteGatewayError) throw error
    throw new RemoteGatewayError('transient')
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (abort) signal.removeEventListener('abort', abort)
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
  return {
    id,
    ownerId,
    version: requireInteger(raw, 'version'),
    createdAt: requireTimestamp(raw, 'created_at'),
    updatedAt: requireTimestamp(raw, 'updated_at'),
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

const normalizePayload = (
  entity: EntityName,
  raw: RawRecord,
  ownerId: string,
  rowsByEntity: Map<EntityName, Map<string, RawRecord>> = new Map(),
): Record<string, unknown> => {
  const common = canonicalCommon(entity, raw, ownerId)
  switch (entity) {
    case 'profile':
      if (optionalInteger(raw, 'onboarding_version') !== 1) {
        return {
          ...common,
          businessName: requireString(raw, 'business_name'),
          ...(optionalString(raw, 'logo_path') ? { logoPath: optionalString(raw, 'logo_path') } : {}),
        }
      }
      return {
        ...common,
        displayName: requireString(raw, 'display_name'),
        businessName: requireString(raw, 'business_name'),
        tradeType: requireString(raw, 'trade_type'),
        hourlyRateCents: requireInteger(raw, 'hourly_rate_cents'),
        taxBasisPoints: requireInteger(raw, 'tax_basis_points'),
        paymentTerms: requireString(raw, 'payment_terms'),
        countryCode: requireString(raw, 'country_code'),
        currency: requireString(raw, 'currency'),
        timeZone: requireString(raw, 'time_zone'),
        onboardingVersion: 1,
        onboardingCompletedAt: requireTimestamp(raw, 'onboarding_completed_at'),
        ...(optionalString(raw, 'logo_path') ? { logoPath: optionalString(raw, 'logo_path') } : {}),
      }
    case 'client':
      return {
        ...common,
        name: requireString(raw, 'name'),
        ...(optionalString(raw, 'phone') ? { phone: optionalString(raw, 'phone') } : {}),
        ...(optionalString(raw, 'email') ? { email: optionalString(raw, 'email') } : {}),
        ...(optionalString(raw, 'address') ? { address: optionalString(raw, 'address') } : {}),
        ...(optionalString(raw, 'city') ? { city: optionalString(raw, 'city') } : {}),
        ...(optionalString(raw, 'state') ? { state: optionalString(raw, 'state') } : {}),
        ...(optionalString(raw, 'postal_code') ? { postalCode: optionalString(raw, 'postal_code') } : {}),
        ...(optionalString(raw, 'notes') ? { notes: optionalString(raw, 'notes') } : {}),
      }
    case 'job':
      return {
        ...common,
        clientId: requireString(raw, 'client_id'),
        title: requireString(raw, 'title'),
        status: requireString(raw, 'status'),
        tradeType: requireString(raw, 'trade_type'),
        ...(optionalString(raw, 'address') ? { address: optionalString(raw, 'address') } : {}),
        ...(optionalString(raw, 'description') ? { description: optionalString(raw, 'description') } : {}),
        laborHoursThousandths: optionalInteger(raw, 'labor_hours_thousandths'),
        laborRateCents: optionalInteger(raw, 'labor_rate_cents'),
        ...(optionalString(raw, 'notes') ? { notes: optionalString(raw, 'notes') } : {}),
        ...(optionalString(raw, 'scheduled_at') ? { scheduledAt: requireTimestamp(raw, 'scheduled_at') } : {}),
        ...(optionalString(raw, 'completed_at') ? { completedAt: requireTimestamp(raw, 'completed_at') } : {}),
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
      const client = relatedClient ?? rowsByEntity.get('client')?.get(clientId)
      const job = jobId ? relatedJob ?? rowsByEntity.get('job')?.get(jobId) : undefined
      if (!client || (jobId && !job)) throw new RemoteGatewayError('invalid-response')
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
      return {
        ...common,
        vendor: requireString(raw, 'vendor'),
        amountCents: requireInteger(raw, 'amount_cents'),
        category: requireString(raw, 'category'),
        expenseDate: requireString(raw, 'expense_date'),
        ...(optionalString(raw, 'job_id') ? { jobId: optionalString(raw, 'job_id') } : {}),
        ...(optionalString(raw, 'client_id') ? { clientId: optionalString(raw, 'client_id') } : {}),
        ...(optionalString(raw, 'notes') ? { notes: optionalString(raw, 'notes') } : {}),
        ...(optionalString(raw, 'receipt_path') ? { receiptPath: optionalString(raw, 'receipt_path') } : {}),
      }
    case 'service':
      return {
        ...common,
        name: requireString(raw, 'name'),
        unitPriceCents: requireInteger(raw, 'unit_price_cents'),
        ...(optionalString(raw, 'description') ? { description: optionalString(raw, 'description') } : {}),
        estimatedHoursThousandths: optionalInteger(raw, 'estimated_hours_thousandths'),
        ...(optionalString(raw, 'category') ? { category: optionalString(raw, 'category') } : {}),
      }
    case 'inventory':
      return {
        ...common,
        name: requireString(raw, 'name'),
        unitPriceCents: requireInteger(raw, 'unit_price_cents'),
        quantityThousandths: optionalInteger(raw, 'quantity_thousandths'),
        unit: optionalString(raw, 'unit') ?? 'each',
        minStockThousandths: optionalInteger(raw, 'min_stock_thousandths'),
        ...(optionalString(raw, 'last_used_at') ? { lastUsedAt: requireTimestamp(raw, 'last_used_at') } : {}),
      }
  }
}

const envelopeFromRaw = (
  entity: EntityName,
  raw: RawRecord,
  ownerId: string,
  rowsByEntity?: Map<EntityName, Map<string, RawRecord>>,
): CloudRowEnvelope => {
  const payload = normalizePayload(entity, raw, ownerId, rowsByEntity)
  return {
    ownerId,
    entity,
    entityId: String(payload.id),
    payload,
    version: Number(payload.version),
    updatedAt: String(payload.updatedAt),
  }
}

const receiptPosition = (
  value: unknown,
  expectedUpdatedAt: string,
  allowedSources: readonly NonNullable<CloudRowEnvelope['changeSource']>[],
): Pick<CloudRowEnvelope, 'changeSeq' | 'changeId' | 'changeSource'> => {
  const position = asRecord(value)
  if (requireTimestamp(position, 'updated_at') !== expectedUpdatedAt) {
    throw new RemoteGatewayError('invalid-response')
  }
  const changeSource = requireString(position, 'source')
  if (!allowedSources.includes(changeSource as NonNullable<CloudRowEnvelope['changeSource']>)) {
    throw new RemoteGatewayError('invalid-response')
  }
  const changeSeq = requireInteger(position, 'change_seq')
  const changeId = requireInteger(position, 'change_id')
  if (
    (changeSource === 'legacy_receipt' && (changeSeq !== 0 || changeId !== 0)) ||
    (changeSource === 'sync_snapshot' && changeId !== 0) ||
    (changeSource === 'sync_changes' && (changeSeq === 0 || changeId === 0))
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  return {
    changeSeq,
    changeId,
    changeSource: changeSource as NonNullable<CloudRowEnvelope['changeSource']>,
  }
}

const mutationRpcPayload = (mutation: MutationEnvelope): unknown => {
  if (mutation.kind !== 'save_invoice_bundle') return mutation.payload
  const bundle = mutation.payload as InvoiceBundlePayload
  const invoiceDraft = bundle.invoice.draft
  return {
    client: { ...bundle.client, baseVersion: bundle.client.version },
    job: { ...bundle.job, baseVersion: bundle.job.version, tradeType: invoiceDraft.tradeType },
    invoice: {
      ...bundle.invoice,
      baseVersion: bundle.invoice.version,
      number: (bundle.invoice as unknown as RawRecord).number ?? bundle.invoice.id,
      lineItems: invoiceDraft.lineItems,
      taxBasisPoints: invoiceDraft.taxBasisPoints,
      paymentTerms: invoiceDraft.paymentTerms,
      notes: invoiceDraft.notes,
      status: (bundle.invoice as unknown as RawRecord).status ?? 'Draft',
    },
  }
}

const requireMutationIdentity = (data: RawRecord, mutation: MutationEnvelope): void => {
  if (requireString(data, 'mutation_id') !== mutation.id) {
    throw new RemoteGatewayError('invalid-response')
  }
}

const bundleRows = (
  rawBundle: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): CloudRowEnvelope[] => {
  const entityIds = asRecord(rawBundle.entity_ids)
  const local = mutation.payload as InvoiceBundlePayload
  if (
    requireString(entityIds, 'client') !== local.client.id ||
    requireString(entityIds, 'job') !== local.job.id ||
    requireString(entityIds, 'invoice') !== local.invoice.id
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const client = asRecord(rawBundle.client)
  const job = asRecord(rawBundle.job)
  const invoice = asRecord(rawBundle.invoice)
  const rowsByEntity = new Map<EntityName, Map<string, RawRecord>>([
    ['client', new Map([[local.client.id, client]])],
    ['job', new Map([[local.job.id, job]])],
  ])
  const rows = [
    envelopeFromRaw('client', client, ownerId, rowsByEntity),
    envelopeFromRaw('job', job, ownerId, rowsByEntity),
    envelopeFromRaw('invoice', invoice, ownerId, rowsByEntity),
  ]
  const positions = asRecord(rawBundle.sync_positions)
  for (const row of rows) {
    Object.assign(row, receiptPosition(
      positions[row.entity],
      row.updatedAt,
      ['sync_changes', 'legacy_receipt'],
    ))
  }
  if (
    rows[0].entityId !== local.client.id ||
    rows[1].entityId !== local.job.id ||
    rows[2].entityId !== local.invoice.id ||
    (rows[1].payload as Record<string, unknown>).clientId !== rows[0].entityId ||
    (rows[2].payload as Record<string, unknown>).clientId !== rows[0].entityId ||
    (rows[2].payload as Record<string, unknown>).jobId !== rows[1].entityId
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  return rows
}

const nullableBundleRows = (
  rawBundle: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): { client: CloudRowEnvelope | null; job: CloudRowEnvelope | null; invoice: CloudRowEnvelope | null } => {
  const entityIds = asRecord(rawBundle.entity_ids)
  const local = mutation.payload as InvoiceBundlePayload
  if (
    requireString(entityIds, 'client') !== local.client.id ||
    requireString(entityIds, 'job') !== local.job.id ||
    requireString(entityIds, 'invoice') !== local.invoice.id
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const rawClient = rawBundle.client === null ? null : asRecord(rawBundle.client)
  const rawJob = rawBundle.job === null ? null : asRecord(rawBundle.job)
  const rawInvoice = rawBundle.invoice === null ? null : asRecord(rawBundle.invoice)
  if ((rawJob && !rawClient) || (rawInvoice && (!rawClient || !rawJob))) {
    throw new RemoteGatewayError('invalid-response')
  }
  const rowsByEntity = new Map<EntityName, Map<string, RawRecord>>()
  if (rawClient) rowsByEntity.set('client', new Map([[local.client.id, rawClient]]))
  if (rawJob) rowsByEntity.set('job', new Map([[local.job.id, rawJob]]))
  const client = rawClient ? envelopeFromRaw('client', rawClient, ownerId, rowsByEntity) : null
  const job = rawJob ? envelopeFromRaw('job', rawJob, ownerId, rowsByEntity) : null
  const invoice = rawInvoice ? envelopeFromRaw('invoice', rawInvoice, ownerId, rowsByEntity) : null
  if (
    (client && client.entityId !== local.client.id) ||
    (job && (
      job.entityId !== local.job.id ||
      (job.payload as Record<string, unknown>).clientId !== local.client.id
    )) ||
    (invoice && (
      invoice.entityId !== local.invoice.id ||
      (invoice.payload as Record<string, unknown>).clientId !== local.client.id ||
      (invoice.payload as Record<string, unknown>).jobId !== local.job.id
    ))
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  return { client, job, invoice }
}

const parseGenericConflict = (
  data: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  if (
    requireString(data, 'entity') !== mutation.entity ||
    requireString(data, 'entity_id') !== mutation.entityId
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const cloudVersion = requireInteger(data, 'cloud_version')
  const positionRaw = asRecord(data.sync_position)
  const positionUpdatedAt = requireTimestamp(positionRaw, 'updated_at')
  const position = receiptPosition(
    positionRaw,
    data.cloud_payload === null
      ? positionUpdatedAt
      : String(envelopeFromRaw(mutation.entity, asRecord(data.cloud_payload), ownerId).updatedAt),
    data.cloud_payload === null
      ? ['sync_changes', 'sync_snapshot']
      : ['sync_changes', 'legacy_receipt'],
  )
  const cloudEnvelope = data.cloud_payload === null
    ? {
        ownerId,
        entity: mutation.entity,
        entityId: mutation.entityId,
        payload: null,
        version: cloudVersion,
        updatedAt: positionUpdatedAt,
        ...position,
        deleted: true,
      } satisfies CloudRowEnvelope
    : Object.assign(envelopeFromRaw(mutation.entity, asRecord(data.cloud_payload), ownerId), position)
  const cloudPayload = cloudEnvelope.payload
  if (
    cloudPayload !== null &&
    (cloudPayload as Record<string, unknown>).version !== cloudVersion
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  return {
    type: 'conflict',
    conflict: {
      mutationId: mutation.id,
      ownerId,
      mutationKind: mutation.kind,
      entity: mutation.entity,
      entityId: mutation.entityId,
      localPayload: mutation.payload,
      cloudPayload,
      cloudVersion,
      cloudRows: [cloudEnvelope],
    },
  }
}

const parseBundleConflict = (
  data: RawRecord,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  if (requireString(data, 'entity') !== 'invoice_bundle') {
    throw new RemoteGatewayError('invalid-response')
  }
  const cloudRaw = asRecord(data.cloud_payload)
  const rows = nullableBundleRows({
    entity_ids: data.entity_ids,
    client: cloudRaw.client,
    job: cloudRaw.job,
    invoice: cloudRaw.invoice,
  }, mutation, ownerId)
  const versions = asRecord(data.cloud_versions)
  if (
    requireInteger(versions, 'client') !== (rows.client?.version ?? 0) ||
    requireInteger(versions, 'job') !== (rows.job?.version ?? 0) ||
    requireInteger(versions, 'invoice') !== (rows.invoice?.version ?? 0)
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const localEcho = asRecord(data.local_payload)
  const local = mutation.payload as InvoiceBundlePayload
  if (
    requireString(asRecord(localEcho.client), 'id') !== local.client.id ||
    requireString(asRecord(localEcho.job), 'id') !== local.job.id ||
    requireString(asRecord(localEcho.invoice), 'id') !== local.invoice.id
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const positions = asRecord(data.sync_positions)
  const cloudRows = (['client', 'job', 'invoice'] as const).map((entity) => {
    const row = rows[entity]
    const localRow = local[entity]
    const positionRaw = asRecord(positions[entity])
    const positionUpdatedAt = requireTimestamp(positionRaw, 'updated_at')
    const position = receiptPosition(
      positionRaw,
      row?.updatedAt ?? positionUpdatedAt,
      row === null
        ? ['sync_changes', 'sync_snapshot']
        : ['sync_changes', 'legacy_receipt'],
    )
    return row
      ? Object.assign(row, position)
      : {
          ownerId,
          entity,
          entityId: localRow.id,
          payload: null,
          version: 0,
          updatedAt: positionUpdatedAt,
          ...position,
          deleted: true,
        } satisfies CloudRowEnvelope
  })
  return {
    type: 'conflict',
    conflict: {
      mutationId: mutation.id,
      ownerId,
      mutationKind: 'save_invoice_bundle',
      entity: 'invoice',
      entityId: local.invoice.id,
      localPayload: mutation.payload,
      cloudPayload: {
        client: rows.client?.payload ?? null,
        job: rows.job?.payload ?? null,
        invoice: rows.invoice?.payload ?? null,
      },
      cloudVersion: rows.invoice?.version ?? 0,
      cloudRows,
    },
  }
}

const parsePushResponse = (
  value: unknown,
  mutation: MutationEnvelope,
  ownerId: string,
): PushResult => {
  const data = asRecord(value)
  requireMutationIdentity(data, mutation)
  const status = requireString(data, 'status')
  if (status === 'conflict') {
    return mutation.kind === 'save_invoice_bundle'
      ? parseBundleConflict(data, mutation, ownerId)
      : parseGenericConflict(data, mutation, ownerId)
  }
  if (status !== 'applied') throw new RemoteGatewayError('invalid-response')

  if (mutation.kind === 'save_invoice_bundle') {
    if (requireString(data, 'entity') !== 'invoice_bundle') {
      throw new RemoteGatewayError('invalid-response')
    }
    return { type: 'applied', rows: bundleRows(data, mutation, ownerId) }
  }
  if (
    requireString(data, 'entity') !== mutation.entity ||
    requireString(data, 'kind') !== mutation.kind ||
    requireString(data, 'entity_id') !== mutation.entityId
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  if (Object.prototype.hasOwnProperty.call(data, 'repair_from_feed')) {
    const position = asRecord(data.sync_position)
    const positionUpdatedAt = requireTimestamp(position, 'updated_at')
    if (
      data.repair_from_feed !== true ||
      mutation.entity !== 'invoice' ||
      mutation.kind === 'delete' ||
      data.cloud !== null ||
      requireInteger(position, 'change_seq') !== 0 ||
      requireInteger(position, 'change_id') !== 0 ||
      requireString(position, 'source') !== 'legacy_receipt'
    ) {
      throw new RemoteGatewayError('invalid-response')
    }
    receiptPosition(position, positionUpdatedAt, ['legacy_receipt'])
    return { type: 'applied', rows: [], requiresBootstrapRepair: true }
  }
  if (mutation.kind === 'delete') {
    const updatedAt = requireTimestamp(data, 'deleted_at')
    return {
      type: 'applied',
      rows: [{
        ownerId,
        entity: mutation.entity,
        entityId: mutation.entityId,
        payload: null,
        version: requireInteger(data, 'deleted_version'),
        updatedAt,
        ...receiptPosition(data.sync_position, updatedAt, ['sync_changes', 'legacy_receipt']),
        deleted: true,
      }],
    }
  }
  const row = envelopeFromRaw(mutation.entity, asRecord(data.cloud), ownerId)
  if (row.entityId !== mutation.entityId) throw new RemoteGatewayError('invalid-response')
  Object.assign(row, receiptPosition(
    data.sync_position,
    row.updatedAt,
    ['sync_changes', 'legacy_receipt'],
  ))
  return { type: 'applied', rows: [row] }
}

const parsePull = (
  value: unknown,
  ownerId: string,
  previous: CursorTuple | null,
): PullResult => {
  const data = asRecord(value)
  if (requireString(data, 'status') !== 'ok' || !Array.isArray(data.changes)) {
    throw new RemoteGatewayError('invalid-response')
  }
  const cursorRaw = asRecord(data.cursor)
  const cursor = {
    updatedAt: requireTimestamp(cursorRaw, 'updated_at'),
    changeSeq: requireInteger(cursorRaw, 'change_seq'),
    changeId: requireInteger(cursorRaw, 'change_id'),
  }
  const parsed = data.changes.map((value) => {
    const change = asRecord(value)
    if (requireString(change, 'owner_id') !== ownerId) {
      throw new RemoteGatewayError('invalid-response')
    }
    const position = {
      updatedAt: requireTimestamp(change, 'updated_at'),
      changeSeq: requireInteger(change, 'change_seq'),
      changeId: requireInteger(change, 'change_id'),
    }
    if (position.changeSeq === 0 || position.changeId === 0) {
      throw new RemoteGatewayError('invalid-response')
    }
    return {
      change,
      position,
      entity: requireEntity(change, 'entity'),
      entityId: requireString(change, 'entity_id'),
      version: requireInteger(change, 'version'),
      deleted: requireBoolean(change, 'deleted'),
    }
  })
  if (parsed.length > PULL_LIMIT) throw new RemoteGatewayError('invalid-response')
  const expectedFirstSequence = (previous?.changeSeq ?? 0) + 1
  if (parsed.length > 0 && parsed[0].position.changeSeq !== expectedFirstSequence) {
    throw new RemoteGatewayError('invalid-response')
  }
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].position.changeSeq !== parsed[index - 1].position.changeSeq + 1) {
      throw new RemoteGatewayError('invalid-response')
    }
  }
  if (parsed.length > 0) {
    if (!cursorEquals(parsed.at(-1)!.position, cursor)) {
      throw new RemoteGatewayError('invalid-response')
    }
  } else if (previous) {
    if (!cursorEquals(previous, cursor)) throw new RemoteGatewayError('invalid-response')
  } else if (
    cursor.changeSeq !== 0 ||
    cursor.changeId !== 0 ||
    Date.parse(cursor.updatedAt) !== 0
  ) {
    throw new RemoteGatewayError('invalid-response')
  }
  const rows = parsed.map((item): CloudRowEnvelope => {
    if (item.deleted) {
      if (item.change.payload !== null) throw new RemoteGatewayError('invalid-response')
      return {
        ownerId,
        entity: item.entity,
        entityId: item.entityId,
        payload: null,
        version: item.version,
        updatedAt: item.position.updatedAt,
        changeSeq: item.position.changeSeq,
        changeId: item.position.changeId,
        changeSource: 'sync_changes',
        deleted: true,
      }
    }
    const row = envelopeFromRaw(
      item.entity,
      asRecord(item.change.payload),
      ownerId,
    )
    if (
      row.entityId !== item.entityId ||
      row.version !== item.version ||
      row.updatedAt !== item.position.updatedAt
    ) {
      throw new RemoteGatewayError('invalid-response')
    }
    row.changeSeq = item.position.changeSeq
    row.changeId = item.position.changeId
    row.changeSource = 'sync_changes'
    return row
  })
  const hasMore = requireBoolean(data, 'has_more')
  if (hasMore && rows.length === 0) throw new RemoteGatewayError('invalid-response')
  return { rows, cursor: encodeCursor(cursor), hasMore }
}

export const createSupabaseGateway = (
  suppliedClient?: SupabaseGatewayClient,
  options: SupabaseGatewayOptions = {},
): RemoteGateway => {
  const client = suppliedClient ?? getSupabaseClient() as unknown as SupabaseGatewayClient
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new Error('The synchronization deadline must be a positive number')
  }

  return {
    async pullSince(ownerId, cursorValue, signal): Promise<PullResult> {
      if (!ownerId) throw new RemoteGatewayError('invalid-response')
      const cursor = decodeCursor(cursorValue)
      const reply = await callProvider(() => client.rpc('pull_sync_changes', {
        p_cursor_change_seq: cursor?.changeSeq ?? null,
        p_limit: PULL_LIMIT,
      }), signal, deadlineMs)
      return parsePull(reply.data, ownerId, cursor)
    },

    async pushMutation(ownerId, mutation, signal): Promise<PushResult> {
      if (!ownerId || mutation.ownerId !== ownerId) {
        throw new RemoteGatewayError('invalid-response')
      }
      const reply = mutation.kind === 'save_invoice_bundle'
        ? await callProvider(() => client.rpc('save_invoice_bundle', {
            p_mutation_id: mutation.id,
            p_payload: mutationRpcPayload(mutation),
          }), signal, deadlineMs, true)
        : mutation.entity === 'profile' && mutation.kind === 'create'
          ? await callProvider(() => client.rpc('save_fieldcraft_onboarding', {
              p_mutation_id: mutation.id,
              p_payload: mutation.payload,
            }), signal, deadlineMs, true)
        : await callProvider(() => client.rpc('apply_entity_mutation', {
            p_mutation_id: mutation.id,
            p_entity: mutation.entity,
            p_kind: mutation.kind,
            p_entity_id: mutation.entityId,
            p_base_version: mutation.baseVersion,
            p_payload: mutation.kind === 'delete' ? {} : mutation.payload,
          }), signal, deadlineMs, true)
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
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          onFailure?.()
        }
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
