import type { SQLiteDatabase } from 'expo-sqlite'
import { z } from 'zod'

import type { ConflictRecord, EntityName, MutationEnvelope } from '../domain/sync'
import { calculateInvoice, InvoiceDraftSchema } from '../domain/invoice'
import { MAX_MONEY_CENTS } from '../domain/limits'
import { openFieldCraftDatabase } from './database'
import { applyMigrations } from './migrations'
import {
  canonicalStringify,
  hashMutationEnvelope,
  SQLiteMutationOutbox,
  type MutationOutbox,
} from './outbox'
import { OwnerBoundary } from './ownerBoundary'
import { parsePostgresTimestamp } from './postgresTimestamp'
import {
  DataCorruptionError,
  OutboxCorruptionError,
  type CloudRowEnvelope,
  type FieldCraftRepository,
  type InvoiceBundleCloudPayload,
  type InvoiceBundlePayload,
  type MutationFailureReason,
} from './repository'

const EntityNameSchema = z.enum([
  'profile',
  'client',
  'job',
  'invoice',
  'expense',
  'service',
  'inventory',
])
const MutationKindSchema = z.enum(['create', 'update', 'delete', 'save_invoice_bundle'])
const SyncStateSchema = z.enum(['current', 'pending', 'syncing', 'failed', 'conflict'])
const MoneySchema = z.number().finite().int().min(0).max(MAX_MONEY_CENTS)

const VersionedEntitySchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    version: z.number().finite().int().min(0),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    syncState: SyncStateSchema,
  })
  .strict()

const entityPayloadSchemas: Record<EntityName, z.ZodType> = {
  profile: VersionedEntitySchema.extend({ businessName: z.string().min(1) }),
  client: VersionedEntitySchema.extend({
    name: z.string().min(1).max(200),
    phone: z.string().max(64).optional(),
    email: z.string().max(320).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postalCode: z.string().max(32).optional(),
    notes: z.string().max(4000).optional(),
  }),
  job: VersionedEntitySchema.extend({
    clientId: z.string().min(1),
    title: z.string().min(1).max(200),
    status: z.enum(['Scheduled', 'In Progress', 'Invoiced', 'Paid']),
    tradeType: z.enum([
      'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting',
    ]).optional(),
    address: z.string().max(500).optional(),
    description: z.string().max(4000).optional(),
    laborHoursThousandths: z.number().finite().int().min(0).max(10_000).optional(),
    laborRateCents: MoneySchema.optional(),
    notes: z.string().max(4000).optional(),
    scheduledAt: z.string().optional(),
    completedAt: z.string().optional(),
  }),
  invoice: VersionedEntitySchema.extend({
    clientId: z.string().min(1),
    jobId: z.string().min(1).optional(),
    draft: InvoiceDraftSchema,
    subtotalCents: MoneySchema,
    taxCents: MoneySchema,
    totalCents: MoneySchema,
  }),
  expense: VersionedEntitySchema.extend({
    vendor: z.string().min(1).max(200),
    amountCents: MoneySchema,
    category: z.enum(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other']),
    expenseDate: z.iso.date(),
    jobId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    notes: z.string().max(4000).optional(),
    receiptPath: z.string().max(500).optional(),
  }),
  service: VersionedEntitySchema.extend({
    name: z.string().min(1).max(200),
    unitPriceCents: MoneySchema,
    description: z.string().max(4000).optional(),
    estimatedHoursThousandths: z.number().finite().int().min(0).max(10_000).optional(),
    category: z.string().max(100).optional(),
  }),
  inventory: VersionedEntitySchema.extend({
    name: z.string().min(1).max(200),
    unitPriceCents: MoneySchema,
    quantityThousandths: z.number().finite().int().min(0).max(10_000).optional(),
    unit: z.string().min(1).max(32).optional(),
    minStockThousandths: z.number().finite().int().min(0).max(10_000).optional(),
    lastUsedAt: z.string().optional(),
  }),
}

const InvoiceBundlePayloadSchema = z
  .object({
    client: entityPayloadSchemas.client,
    job: entityPayloadSchemas.job,
    invoice: entityPayloadSchemas.invoice,
  })
  .strict()

const MutationEnvelopeSchema = z
  .object({
    id: z.uuid(),
    ownerId: z.string().min(1),
    entity: EntityNameSchema,
    entityId: z.string().min(1),
    kind: MutationKindSchema,
    baseVersion: z.number().finite().int().min(0).nullable(),
    payload: z.unknown(),
    createdAt: z.string().min(1),
    attempts: z.number().finite().int().min(0),
  })
  .strict()

const CloudRowEnvelopeSchema = z
  .object({
    ownerId: z.string().min(1),
    entity: EntityNameSchema,
    entityId: z.string().min(1),
    payload: z.unknown(),
    version: z.number().finite().int().min(0),
    updatedAt: z.string().min(1),
    changeSeq: z.number().finite().int().min(0).optional(),
    changeId: z.number().finite().int().min(0).optional(),
    changeSource: z.enum(['sync_changes', 'sync_snapshot', 'legacy_receipt']).optional(),
    deleted: z.boolean().optional(),
  })
  .strict()

const ConflictRecordSchema = z
  .object({
    mutationId: z.uuid(),
    ownerId: z.string().min(1).optional(),
    mutationKind: MutationKindSchema.optional(),
    entity: EntityNameSchema,
    entityId: z.string().min(1),
    localPayload: z.unknown(),
    cloudPayload: z.unknown(),
    cloudVersion: z.number().finite().int().min(0),
    cloudRows: z.array(CloudRowEnvelopeSchema).min(1),
  })
  .strict()

const MutationFailureReasonSchema = z.enum([
  'transient',
  'reauthentication',
  'validation',
  'invalid-response',
])

type RecordRow = {
  entity_id: string
  payload_json: string
}

type ReconciliationRecordRow = {
  entity: EntityName
  entity_id: string
  payload_json: string
  version: number
  deleted: number
  updated_at: string
  change_seq: number
  change_id: number
}

type ReconciliationOutboxRow = {
  entity: EntityName
  entity_id: string
  kind: MutationEnvelope['kind']
  payload_json: string
}

type LaterOutboxRow = ReconciliationOutboxRow & {
  sequence: number
  mutation_id: string
  base_version: number | null
  created_at: string
  attempts: number
  payload_hash: string
}

type ExistingMutationRow = {
  payload_hash: string
}

type NextSequenceRow = {
  next_sequence: number
}

type SyncCursorRow = {
  cursor: string
}

type MetadataRow = {
  value: string
}

type ConflictRow = {
  mutation_id: string
  mutation_kind: MutationEnvelope['kind']
  entity: EntityName
  entity_id: string
  local_payload_json: string
  cloud_payload_json: string
  cloud_version: number
  cloud_rows_json: string | null
}

type ServerAuthorityRow = {
  owner_id: string
  entity: EntityName
  entity_id: string
  payload_json: string
  version: number
  deleted: number
  updated_at: string
  change_source: NonNullable<CloudRowEnvelope['changeSource']>
  change_seq: number
  change_id: number
}

type SyncChangeEventRow = {
  change_seq: number
  change_id: number
}

type CountRow = {
  count: number
}

type PreparedCloudRow = {
  row: CloudRowEnvelope
  payloadJson: string
}

const FEED_RECONCILIATION_KEY = 'sync-feed-v2-reconciliation-required'
const FEED_RECONCILIATION_TERMINAL_KEY = 'sync-feed-v2-terminal-reconciliation-pending'
const recordKey = (entity: EntityName, entityId: string): string => `${entity}:${entityId}`

type ImmutablePosition = {
  updatedAt: string
  changeSeq: number
  changeId: number
  changeSource: NonNullable<CloudRowEnvelope['changeSource']>
}

const parsePreciseTimestamp = (value: string) => {
  try {
    return parsePostgresTimestamp(value)
  } catch (cause) {
    throw new DataCorruptionError(
      'Synchronization position contains an invalid timestamp',
      { cause },
    )
  }
}

const compareImmutablePositions = (
  left: ImmutablePosition,
  right: ImmutablePosition,
): number => {
  const leftIsSync = left.changeSource !== 'legacy_receipt'
  const rightIsSync = right.changeSource !== 'legacy_receipt'
  if (leftIsSync !== rightIsSync) return leftIsSync ? 1 : -1
  if (leftIsSync) {
    return left.changeSeq - right.changeSeq ||
      left.changeId - right.changeId ||
      (left.changeSource === right.changeSource
        ? 0
        : left.changeSource === 'sync_snapshot' ? 1 : -1)
  }
  const leftTime = parsePreciseTimestamp(left.updatedAt)
  const rightTime = parsePreciseTimestamp(right.updatedAt)
  return leftTime.wholeSecondMilliseconds - rightTime.wholeSecondMilliseconds ||
    leftTime.microseconds - rightTime.microseconds ||
    left.changeId - right.changeId
}

const parseSyncCursorTuple = (cursor: string): ImmutablePosition => {
  try {
    const value: unknown = JSON.parse(cursor)
    const parsed = z.object({
      updatedAt: z.string().min(1),
      changeSeq: z.number().finite().int().min(0),
      changeId: z.number().finite().int().min(0),
    }).strict().parse(value)
    parsePreciseTimestamp(parsed.updatedAt)
    return { ...parsed, changeSource: 'sync_changes' }
  } catch (cause) {
    if (cause instanceof DataCorruptionError) throw cause
    throw new DataCorruptionError('Terminal bootstrap cursor is invalid', { cause })
  }
}

const validateEntityPayload = (
  entity: EntityName,
  payload: unknown,
  ownerId: string,
  entityId: string,
): Record<string, unknown> => {
  const parsed = entityPayloadSchemas[entity].parse(payload) as Record<string, unknown>
  if (parsed.ownerId !== ownerId || parsed.id !== entityId) {
    throw new Error('Entity payload owner and ID must match its mutation envelope')
  }
  parsePreciseTimestamp(String(parsed.createdAt))
  parsePreciseTimestamp(String(parsed.updatedAt))
  if (entity === 'invoice') {
    const invoice = parsed as Record<string, unknown> & {
      draft: Parameters<typeof calculateInvoice>[0]
      subtotalCents: number
      taxCents: number
      totalCents: number
    }
    const calculated = calculateInvoice(invoice.draft)
    if (
      invoice.subtotalCents !== calculated.subtotalCents ||
      invoice.taxCents !== calculated.taxCents ||
      invoice.totalCents !== calculated.totalCents
    ) {
      throw new Error('Invoice subtotal, tax, and total must match deterministic invoice math')
    }
  }
  return parsed
}

const validateBundlePayload = (
  payload: unknown,
  ownerId: string,
  invoiceId: string,
): InvoiceBundlePayload => {
  const parsed = InvoiceBundlePayloadSchema.parse(payload) as InvoiceBundlePayload
  const client = validateEntityPayload('client', parsed.client, ownerId, parsed.client.id)
  const job = validateEntityPayload('job', parsed.job, ownerId, parsed.job.id)
  const invoice = validateEntityPayload('invoice', parsed.invoice, ownerId, invoiceId)
  if (
    job.clientId !== client.id ||
    invoice.clientId !== client.id ||
    invoice.jobId !== job.id
  ) {
    throw new Error('Invoice bundle client, job, and invoice relationships must match')
  }
  return { client, job, invoice } as InvoiceBundlePayload
}

const validateCloudBundlePayload = (
  payload: unknown,
  ownerId: string,
  local: InvoiceBundlePayload,
): InvoiceBundleCloudPayload => {
  const parsed = z.object({
    client: z.unknown().nullable(),
    job: z.unknown().nullable(),
    invoice: z.unknown().nullable(),
  }).strict().parse(payload)
  const client = parsed.client === null
    ? null
    : validateEntityPayload('client', parsed.client, ownerId, local.client.id) as InvoiceBundlePayload['client']
  const job = parsed.job === null
    ? null
    : validateEntityPayload('job', parsed.job, ownerId, local.job.id) as InvoiceBundlePayload['job']
  const invoice = parsed.invoice === null
    ? null
    : validateEntityPayload('invoice', parsed.invoice, ownerId, local.invoice.id) as InvoiceBundlePayload['invoice']
  if ((job && !client) || (invoice && (!client || !job))) {
    throw new Error('Cloud invoice bundle deletions must preserve relationship order')
  }
  if (
    (job && job.clientId !== local.client.id) ||
    (invoice && (
      invoice.clientId !== local.client.id ||
      invoice.jobId !== local.job.id
    ))
  ) {
    throw new Error('Cloud invoice bundle relationships must match the local bundle identity')
  }
  return { client, job, invoice }
}

const prepareCloudRows = (
  inputRows: CloudRowEnvelope[],
  ownerId: string,
): PreparedCloudRow[] => {
  try {
    return inputRows.map((input) => {
      const row = CloudRowEnvelopeSchema.parse(input) as CloudRowEnvelope
      const hasSource = row.changeSource !== undefined
      const hasSequence = row.changeSeq !== undefined
      const hasEventId = row.changeId !== undefined
      if (hasSource || hasSequence || hasEventId) {
        const valid = hasSource && hasSequence && hasEventId && (
          (row.changeSource === 'sync_changes' && row.changeSeq! > 0 && row.changeId! > 0) ||
          (row.changeSource === 'sync_snapshot' && row.changeSeq! >= 0 && row.changeId === 0) ||
          (row.changeSource === 'legacy_receipt' && row.changeSeq === 0 && row.changeId === 0)
        )
        if (!valid) {
          throw new DataCorruptionError(
            'Cloud row source requires its complete matching immutable position',
          )
        }
      }
      if (row.ownerId !== ownerId) {
        throw new Error('Cloud row owner does not match the active repository owner')
      }
      parsePreciseTimestamp(row.updatedAt)
      if (row.deleted && row.payload !== null) {
        throw new Error('Deleted cloud rows require a null tombstone payload')
      }
      if (
        row.changeSource === 'sync_snapshot' &&
        (!row.deleted || row.payload !== null || row.version !== 0)
      ) {
        throw new DataCorruptionError(
          'Snapshot authority is valid only for a version-zero absent tombstone',
        )
      }
      const payload = row.deleted
        ? null
        : validateEntityPayload(row.entity, row.payload, row.ownerId, row.entityId)
      if (payload) {
        if (payload.version !== row.version) {
          throw new Error('Cloud row payload version must match its envelope version')
        }
        if (payload.updatedAt !== row.updatedAt) {
          throw new Error('Cloud row payload updatedAt must match its envelope updatedAt')
        }
      }
      return { row, payloadJson: canonicalStringify(payload) }
    })
  } catch (cause) {
    if (cause instanceof DataCorruptionError) throw cause
    throw new DataCorruptionError('Cloud authority response is invalid', { cause })
  }
}

const requirePositionedRows = (prepared: PreparedCloudRow[], operation: string): void => {
  for (const { row } of prepared) {
    if (
      row.changeSource === undefined ||
      row.changeSeq === undefined ||
      row.changeId === undefined
    ) {
      throw new DataCorruptionError(`${operation} requires complete server authority`)
    }
  }
}

const requireAuthoritySources = (
  prepared: PreparedCloudRow[],
  allowed: readonly NonNullable<CloudRowEnvelope['changeSource']>[],
  operation: string,
): void => {
  for (const { row } of prepared) {
    if (
      row.changeSource === undefined ||
      !allowed.includes(row.changeSource)
    ) {
      throw new DataCorruptionError(
        `${operation} requires authority from ${allowed.join(' or ')}`,
      )
    }
  }
}

const writeCloudRows = async (
  database: SQLiteDatabase,
  prepared: PreparedCloudRow[],
): Promise<void> => {
  for (const { row, payloadJson } of prepared) {
    await database.runAsync(
      `/* records:upsert */
       INSERT INTO records
         (owner_id, entity, entity_id, payload_json, version, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         version = excluded.version,
         deleted = excluded.deleted,
         updated_at = excluded.updated_at`,
      [row.ownerId, row.entity, row.entityId, payloadJson, row.version, row.deleted ? 1 : 0, row.updatedAt],
    )
  }
}

const authorityPosition = (row: CloudRowEnvelope): ImmutablePosition => {
  if (
    row.changeSource === undefined ||
    row.changeSeq === undefined ||
    row.changeId === undefined
  ) {
    throw new DataCorruptionError('Server authority is missing its complete position')
  }
  return {
    updatedAt: row.updatedAt,
    changeSource: row.changeSource,
    changeSeq: row.changeSeq,
    changeId: row.changeId,
  }
}

const cloudRowFromAuthority = (row: ServerAuthorityRow): CloudRowEnvelope => {
  let payload: unknown
  try {
    payload = JSON.parse(row.payload_json)
  } catch (cause) {
    throw new DataCorruptionError('Stored server authority contains corrupt JSON', { cause })
  }
  return {
    ownerId: row.owner_id,
    entity: row.entity,
    entityId: row.entity_id,
    payload,
    version: row.version,
    updatedAt: row.updated_at,
    changeSource: row.change_source,
    changeSeq: row.change_seq,
    changeId: row.change_id,
    ...(row.deleted === 1 ? { deleted: true } : {}),
  }
}

const writeServerAuthorityRows = async (
  database: SQLiteDatabase,
  prepared: PreparedCloudRow[],
): Promise<Set<string>> => {
  requirePositionedRows(prepared, 'Server authority write')
  const affected = new Set<string>()
  for (const candidate of prepared) {
    const { row, payloadJson } = candidate
    const key = recordKey(row.entity, row.entityId)
    affected.add(key)
    if (row.changeSource === 'sync_changes') {
      const bySequence = await database.getFirstAsync<SyncChangeEventRow>(
        `/* sync-change-events:get-by-sequence */
         SELECT change_seq, change_id
         FROM sync_change_events
         WHERE owner_id = ? AND change_seq = ?`,
        [row.ownerId, row.changeSeq!],
      )
      if (bySequence && bySequence.change_id !== row.changeId) {
        throw new DataCorruptionError(
          'One owner sequence cannot identify different sync-change events',
        )
      }
      const byChangeId = await database.getFirstAsync<SyncChangeEventRow>(
        `/* sync-change-events:get-by-id */
         SELECT change_seq, change_id
         FROM sync_change_events
         WHERE owner_id = ? AND change_id = ?`,
        [row.ownerId, row.changeId!],
      )
      if (byChangeId && byChangeId.change_seq !== row.changeSeq) {
        throw new DataCorruptionError(
          'One change ID cannot identify different owner sequences',
        )
      }
      if (!bySequence && !byChangeId) {
        await database.runAsync(
          `/* sync-change-events:insert */
           INSERT INTO sync_change_events (owner_id, change_seq, change_id)
           VALUES (?, ?, ?)`,
          [row.ownerId, row.changeSeq!, row.changeId!],
        )
      }
    }
    const existing = await database.getFirstAsync<ServerAuthorityRow>(
      `/* server-authority:get */
       SELECT owner_id, entity, entity_id, payload_json, version, deleted,
              updated_at, change_source, change_seq, change_id
       FROM sync_server_authority
       WHERE owner_id = ? AND entity = ? AND entity_id = ?`,
      [row.ownerId, row.entity, row.entityId],
    )
    if (existing) {
      if (
        row.changeSource === 'sync_changes' &&
        existing.change_source === 'sync_changes' &&
        row.changeSeq === existing.change_seq &&
        row.changeId !== existing.change_id
      ) {
        throw new DataCorruptionError(
          'One owner sequence cannot identify different sync-change events',
        )
      }
      const comparison = compareImmutablePositions(
        authorityPosition(row),
        authorityPosition(cloudRowFromAuthority(existing)),
      )
      if (comparison < 0) continue
      if (comparison === 0) {
        const sameAuthority = existing.payload_json === payloadJson &&
          existing.version === row.version &&
          existing.deleted === (row.deleted ? 1 : 0) &&
          (
            row.changeSource === 'sync_snapshot' ||
            existing.updated_at === row.updatedAt
          )
        if (!sameAuthority) {
          throw new DataCorruptionError(
            'One immutable server position cannot identify different authority',
          )
        }
        continue
      }
    }
    await database.runAsync(
      `/* server-authority:upsert */
       INSERT INTO sync_server_authority
         (owner_id, entity, entity_id, payload_json, version, deleted, updated_at,
          change_source, change_seq, change_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         version = excluded.version,
         deleted = excluded.deleted,
         updated_at = excluded.updated_at,
         change_source = excluded.change_source,
         change_seq = excluded.change_seq,
         change_id = excluded.change_id`,
      [
        row.ownerId,
        row.entity,
        row.entityId,
        payloadJson,
        row.version,
        row.deleted ? 1 : 0,
        row.updatedAt,
        row.changeSource!,
        row.changeSeq!,
        row.changeId!,
      ],
    )
  }
  return affected
}

const materializeServerAuthority = async (
  database: SQLiteDatabase,
  ownerId: string,
  keys?: Set<string>,
): Promise<void> => {
  const rows = await database.getAllAsync<ServerAuthorityRow>(
    `/* server-authority:list */
     SELECT owner_id, entity, entity_id, payload_json, version, deleted,
            updated_at, change_source, change_seq, change_id
     FROM sync_server_authority
     WHERE owner_id = ?`,
    [ownerId],
  )
  const selected = keys
    ? rows.filter((row) => keys.has(recordKey(row.entity, row.entity_id)))
    : rows
  await writeCloudRows(
    database,
    prepareCloudRows(selected.map(cloudRowFromAuthority), ownerId),
  )
}

const allOutboxIntentRows = async (
  database: SQLiteDatabase,
  ownerId: string,
): Promise<LaterOutboxRow[]> => database.getAllAsync<LaterOutboxRow>(
  `/* outbox:all-local-intents */
   SELECT sequence, mutation_id, entity, entity_id, kind, base_version,
          payload_json, created_at, attempts, payload_hash
   FROM outbox
   WHERE owner_id = ? AND state <> 'complete'
   ORDER BY sequence ASC`,
  [ownerId],
)

const preparedIntentRows = async (
  rows: LaterOutboxRow[],
  ownerId: string,
): Promise<PreparedCloudRow[]> => {
  const latestByKey = new Map<string, CloudRowEnvelope>()
  for (const row of rows) {
    let payload: unknown
    try {
      payload = JSON.parse(row.payload_json)
    } catch (cause) {
      throw new OutboxCorruptionError(row.mutation_id, undefined, { cause })
    }
    let mutation: MutationEnvelope
    try {
      mutation = validateMutationEnvelope({
        id: row.mutation_id,
        ownerId,
        entity: row.entity,
        entityId: row.entity_id,
        kind: row.kind,
        baseVersion: row.base_version,
        payload,
        createdAt: row.created_at,
        attempts: row.attempts,
      })
      if (await hashMutationEnvelope(mutation) !== row.payload_hash) {
        throw new Error('immutable mutation hash mismatch')
      }
    } catch (cause) {
      throw new OutboxCorruptionError(row.mutation_id, undefined, { cause })
    }
    const intents: CloudRowEnvelope[] = mutation.kind === 'save_invoice_bundle'
      ? (['client', 'job', 'invoice'] as const).map((entity) => {
          const entityPayload = (mutation.payload as InvoiceBundlePayload)[entity]
          return {
            ownerId,
            entity,
            entityId: entityPayload.id,
            payload: entityPayload,
            version: entityPayload.version,
            updatedAt: entityPayload.updatedAt,
          }
        })
      : mutation.kind === 'delete'
        ? [{
            ownerId,
            entity: mutation.entity,
            entityId: mutation.entityId,
            payload: null,
            version: mutation.baseVersion ?? 0,
            updatedAt: mutation.createdAt,
            deleted: true,
          }]
        : [{
            ownerId,
            entity: mutation.entity,
            entityId: mutation.entityId,
            payload: mutation.payload,
            version: Number((mutation.payload as Record<string, unknown>).version),
            updatedAt: String((mutation.payload as Record<string, unknown>).updatedAt),
          }]
    for (const intent of intents) latestByKey.set(recordKey(intent.entity, intent.entityId), intent)
  }
  return prepareCloudRows([...latestByKey.values()], ownerId)
}

const overlayAllLocalIntents = async (
  database: SQLiteDatabase,
  ownerId: string,
): Promise<void> => {
  await writeCloudRows(
    database,
    await preparedIntentRows(await allOutboxIntentRows(database, ownerId), ownerId),
  )
}

const applyServerAuthorityAndOverlay = async (
  database: SQLiteDatabase,
  ownerId: string,
  prepared: PreparedCloudRow[],
): Promise<void> => {
  const affected = await writeServerAuthorityRows(database, prepared)
  await materializeServerAuthority(database, ownerId, affected)
  await overlayAllLocalIntents(database, ownerId)
}

const writeBootstrapRows = async (
  database: SQLiteDatabase,
  prepared: PreparedCloudRow[],
): Promise<void> => {
  for (const { row, payloadJson } of prepared) {
    if (
      row.changeSource !== 'sync_changes' ||
      row.changeSeq === undefined ||
      row.changeId === undefined
    ) {
      throw new DataCorruptionError('Bootstrap cloud rows require a complete sync-change position')
    }
    await database.runAsync(
      `/* bootstrap:stage:upsert */
       INSERT INTO sync_bootstrap_records
         (owner_id, entity, entity_id, payload_json, version, deleted, updated_at,
          change_seq, change_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
         payload_json = excluded.payload_json,
         version = excluded.version,
         deleted = excluded.deleted,
         updated_at = excluded.updated_at,
         change_seq = excluded.change_seq,
         change_id = excluded.change_id
       WHERE excluded.change_seq >= sync_bootstrap_records.change_seq`,
      [
        row.ownerId,
        row.entity,
        row.entityId,
        payloadJson,
        row.version,
        row.deleted ? 1 : 0,
        row.updatedAt,
        row.changeSeq,
        row.changeId,
      ],
    )
  }
}

const protectedReconciliationKeys = async (
  database: SQLiteDatabase,
  ownerId: string,
): Promise<Set<string>> => new Set(
  (await preparedIntentRows(
    await allOutboxIntentRows(database, ownerId),
    ownerId,
  )).map(({ row }) => recordKey(row.entity, row.entityId)),
  )

const scheduleFreshBootstrapReconciliation = async (
  database: SQLiteDatabase,
  ownerId: string,
): Promise<void> => {
  await database.runAsync(
    `/* metadata:reconciliation:schedule */
     INSERT INTO metadata (owner_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`,
    [ownerId, FEED_RECONCILIATION_KEY, 'true'],
  )
  await database.runAsync(
    `/* metadata:initial-pull:delete */
     DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, 'initial-cloud-pull-complete'],
  )
  await database.runAsync(
    `/* metadata:reconciliation-terminal:delete */
     DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_TERMINAL_KEY],
  )
  await database.runAsync(
    `/* sync-cursors:bootstrap-reset */
     DELETE FROM sync_cursors WHERE owner_id = ? AND entity = ?`,
    [ownerId, '__all__'],
  )
  await database.runAsync(
    `/* bootstrap:stage:clear */ DELETE FROM sync_bootstrap_records WHERE owner_id = ?`,
    [ownerId],
  )
}

const finalizeBootstrapReconciliation = async (
  database: SQLiteDatabase,
  ownerId: string,
): Promise<boolean> => {
  const stagedRows = await database.getAllAsync<ReconciliationRecordRow>(
    `/* bootstrap:records:list */
     SELECT entity, entity_id, payload_json, version, deleted, updated_at, change_seq, change_id
     FROM sync_bootstrap_records
     WHERE owner_id = ?`,
    [ownerId],
  )
  const currentRows = await database.getAllAsync<Pick<ReconciliationRecordRow, 'entity' | 'entity_id'>>(
    `/* bootstrap:current:list */
     SELECT entity, entity_id FROM records WHERE owner_id = ?`,
    [ownerId],
  )
  const cursorRow = await database.getFirstAsync<SyncCursorRow>(
    `/* sync-cursors:get */
     SELECT cursor FROM sync_cursors WHERE owner_id = ? AND entity = ?`,
    [ownerId, '__all__'],
  )
  if (!cursorRow) throw new DataCorruptionError('Bootstrap terminal page is missing its cursor')
  const terminal = parseSyncCursorTuple(cursorRow.cursor)
  const protectedKeys = await protectedReconciliationKeys(database, ownerId)
  const staged = prepareCloudRows(stagedRows.map((row) => {
    let payload: unknown
    try {
      payload = JSON.parse(row.payload_json)
    } catch (cause) {
      throw new DataCorruptionError('Corrupt staged cloud row during reconciliation', { cause })
    }
    return {
      ownerId,
      entity: row.entity,
      entityId: row.entity_id,
      payload,
      version: row.version,
      updatedAt: row.updated_at,
      changeSeq: row.change_seq,
      changeId: row.change_id,
      changeSource: 'sync_changes',
      ...(row.deleted === 1 ? { deleted: true } : {}),
    }
  }), ownerId)
  const stagedKeys = new Set(
    staged.map(({ row }) => recordKey(row.entity, row.entityId)),
  )
  const absences = prepareCloudRows(currentRows
    .filter((row) => !stagedKeys.has(recordKey(row.entity, row.entity_id)))
    .map((row): CloudRowEnvelope => ({
      ownerId,
      entity: row.entity,
      entityId: row.entity_id,
      payload: null,
      version: 0,
      updatedAt: terminal.updatedAt,
      changeSource: 'sync_snapshot',
      changeSeq: terminal.changeSeq,
      changeId: 0,
      deleted: true,
    })), ownerId)
  await writeServerAuthorityRows(database, [...staged, ...absences])
  await materializeServerAuthority(database, ownerId)
  await overlayAllLocalIntents(database, ownerId)
  if (protectedKeys.size > 0) {
    await database.runAsync(
      `/* metadata:reconciliation-terminal:upsert */
       INSERT INTO metadata (owner_id, key, value)
       VALUES (?, ?, ?)
       ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`,
      [ownerId, FEED_RECONCILIATION_TERMINAL_KEY, 'true'],
    )
    return false
  }
  await database.runAsync(
    `/* bootstrap:stage:clear */ DELETE FROM sync_bootstrap_records WHERE owner_id = ?`,
    [ownerId],
  )
  await database.runAsync(
    `/* metadata:reconciliation-terminal:delete */ DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_TERMINAL_KEY],
  )
  await database.runAsync(
    `/* metadata:reconciliation:delete */ DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_KEY],
  )
  return true
}

const stagedRowIsAtLeastAsNew = (
  staged: ReconciliationRecordRow,
  receipt: PreparedCloudRow,
): boolean => {
  if (receipt.row.changeId !== undefined && receipt.row.changeSeq !== undefined && receipt.row.changeSource) {
    return compareImmutablePositions(
      {
        updatedAt: staged.updated_at,
        changeSeq: staged.change_seq,
        changeId: staged.change_id,
        changeSource: 'sync_changes',
      },
      authorityPosition(receipt.row),
    ) >= 0
  }
  const leftTime = parsePreciseTimestamp(staged.updated_at)
  const rightTime = parsePreciseTimestamp(receipt.row.updatedAt)
  const timestampOrder = leftTime.wholeSecondMilliseconds - rightTime.wholeSecondMilliseconds ||
    leftTime.microseconds - rightTime.microseconds
  if (timestampOrder !== 0) return timestampOrder > 0
  if (staged.deleted !== (receipt.row.deleted ? 1 : 0)) return staged.deleted === 1
  return staged.version >= receipt.row.version
}

const repairAcknowledgedBootstrapRows = async (
  database: SQLiteDatabase,
  ownerId: string,
  receiptRows: PreparedCloudRow[],
): Promise<boolean> => {
  const terminal = await database.getFirstAsync<MetadataRow>(
    `/* metadata:reconciliation-terminal:get */
     SELECT value FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_TERMINAL_KEY],
  )
  if (terminal?.value !== 'true') return false

  const cursorRow = await database.getFirstAsync<SyncCursorRow>(
    `/* sync-cursors:get */
     SELECT cursor FROM sync_cursors WHERE owner_id = ? AND entity = ?`,
    [ownerId, '__all__'],
  )
  if (!cursorRow) {
    throw new DataCorruptionError('Terminal bootstrap reconciliation is missing its cursor')
  }
  const terminalCursor = parseSyncCursorTuple(cursorRow.cursor)

  const stagedRows = await database.getAllAsync<ReconciliationRecordRow>(
    `/* bootstrap:records:list */
     SELECT entity, entity_id, payload_json, version, deleted, updated_at, change_seq, change_id
     FROM sync_bootstrap_records
     WHERE owner_id = ?`,
    [ownerId],
  )
  const receiptByKey = new Map(
    receiptRows.map((row) => [recordKey(row.row.entity, row.row.entityId), row]),
  )
  const stagedKeys = new Set(
    stagedRows.map((row) => recordKey(row.entity, row.entity_id)),
  )
  const repairs = stagedRows.filter((row) => {
    const receipt = receiptByKey.get(recordKey(row.entity, row.entity_id))
    return receipt !== undefined && stagedRowIsAtLeastAsNew(row, receipt)
  })
  if (repairs.length > 0) {
    await writeCloudRows(database, prepareCloudRows(repairs.map((row) => {
      let payload: unknown
      try {
        payload = JSON.parse(row.payload_json)
      } catch (cause) {
        throw new DataCorruptionError('Corrupt staged cloud row during acknowledgement repair', { cause })
      }
      return {
        ownerId,
        entity: row.entity,
        entityId: row.entity_id,
        payload,
        version: row.version,
        updatedAt: row.updated_at,
        changeSeq: row.change_seq,
        changeId: row.change_id,
        changeSource: 'sync_changes',
        ...(row.deleted === 1 ? { deleted: true } : {}),
      }
    }), ownerId))
  }

  const remainingProtected = await protectedReconciliationKeys(database, ownerId)
  for (const receipt of receiptRows) {
    const key = recordKey(receipt.row.entity, receipt.row.entityId)
    if (remainingProtected.has(key)) continue
    const receiptIsCoveredByAbsentSnapshot = !stagedKeys.has(key) && (
      receipt.row.changeSource === 'legacy_receipt' ||
      (
        receipt.row.changeId !== undefined &&
        compareImmutablePositions(
          authorityPosition(receipt.row),
          terminalCursor,
        ) <= 0
      )
    )
    if (receiptIsCoveredByAbsentSnapshot) {
      await database.runAsync(
        `/* bootstrap:records:delete */
         DELETE FROM records WHERE owner_id = ? AND entity = ? AND entity_id = ?`,
        [ownerId, receipt.row.entity, receipt.row.entityId],
      )
    }
    await database.runAsync(
      `/* bootstrap:stage:delete-key */
       DELETE FROM sync_bootstrap_records
       WHERE owner_id = ? AND entity = ? AND entity_id = ?`,
      [ownerId, receipt.row.entity, receipt.row.entityId],
    )
  }
  if (remainingProtected.size > 0) return false

  await database.runAsync(
    `/* bootstrap:stage:clear */ DELETE FROM sync_bootstrap_records WHERE owner_id = ?`,
    [ownerId],
  )
  await database.runAsync(
    `/* metadata:reconciliation-terminal:delete */ DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_TERMINAL_KEY],
  )
  await database.runAsync(
    `/* metadata:reconciliation:delete */ DELETE FROM metadata WHERE owner_id = ? AND key = ?`,
    [ownerId, FEED_RECONCILIATION_KEY],
  )
  await database.runAsync(
    `/* metadata:initial-pull:upsert */
     INSERT INTO metadata (owner_id, key, value)
     VALUES (?, ?, ?)
     ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`,
    [ownerId, 'initial-cloud-pull-complete', 'true'],
  )
  return true
}

const prepareConflictUnchecked = (
  input: ConflictRecord,
  ownerId: string,
): {
  conflict: ConflictRecord
  localPayloadJson: string
  cloudPayloadJson: string
  cloudRowsJson: string
} => {
  const conflict = ConflictRecordSchema.parse(input) as ConflictRecord
  if (conflict.ownerId !== undefined && conflict.ownerId !== ownerId) {
    throw new Error('Conflict owner must match the active owner')
  }
  const cloudRows = prepareCloudRows(conflict.cloudRows, ownerId)
  requirePositionedRows(cloudRows, 'Conflict authority')
  for (const preparedRow of cloudRows) {
    const isAbsent = preparedRow.row.deleted && preparedRow.row.payload === null
    requireAuthoritySources(
      [preparedRow],
      isAbsent
        ? ['sync_changes', 'sync_snapshot']
        : ['sync_changes', 'legacy_receipt'],
      'Conflict authority',
    )
  }
  if (conflict.mutationKind === 'save_invoice_bundle') {
    if (conflict.entity !== 'invoice') {
      throw new Error('Invoice bundle conflicts require entity invoice')
    }
    const localBundle = validateBundlePayload(conflict.localPayload, ownerId, conflict.entityId)
    const cloudBundle = validateCloudBundlePayload(conflict.cloudPayload, ownerId, localBundle)
    if ((cloudBundle.invoice?.version ?? 0) !== conflict.cloudVersion) {
      throw new Error('Bundle conflict invoice version must match the conflict record')
    }
    const expected = new Map((['client', 'job', 'invoice'] as const).map((entity) => {
      const local = localBundle[entity]
      const payload = cloudBundle[entity]
      return [recordKey(entity, local.id), { entity, local, payload }]
    }))
    if (cloudRows.length !== expected.size) {
      throw new Error('Bundle conflict requires one positioned authority row per member')
    }
    for (const preparedRow of cloudRows) {
      const key = recordKey(preparedRow.row.entity, preparedRow.row.entityId)
      const match = expected.get(key)
      if (!match) {
        throw new Error('Bundle conflict requires one positioned authority row per member')
      }
      if (
        canonicalStringify(preparedRow.row.payload) !== canonicalStringify(match.payload) ||
        (preparedRow.row.payload === null && preparedRow.row.version !== 0)
      ) {
        throw new Error('Bundle conflict authority does not match its cloud member')
      }
      expected.delete(key)
    }
    if (expected.size !== 0) {
      throw new Error('Bundle conflict requires one positioned authority row per member')
    }
    return {
      conflict: {
        ...conflict,
        ownerId,
        localPayload: localBundle,
        cloudPayload: cloudBundle,
        cloudRows: cloudRows.map(({ row }) => row),
      },
      localPayloadJson: canonicalStringify(localBundle),
      cloudPayloadJson: canonicalStringify(cloudBundle),
      cloudRowsJson: canonicalStringify(cloudRows.map(({ row }) => row)),
    }
  }
  const localPayload = conflict.mutationKind === 'delete'
    ? conflict.localPayload
    : validateEntityPayload(
        conflict.entity,
        conflict.localPayload,
        ownerId,
        conflict.entityId,
      )
  if (conflict.mutationKind === 'delete' && localPayload !== null) {
    throw new Error('Delete conflicts require a null local tombstone payload')
  }
  const cloudPayload = conflict.cloudPayload === null
    ? null
    : validateEntityPayload(
        conflict.entity,
        conflict.cloudPayload,
        ownerId,
        conflict.entityId,
      )
  if (cloudPayload !== null && cloudPayload.version !== conflict.cloudVersion) {
    throw new Error('Conflict cloud payload version must match the conflict record')
  }
  if (
    cloudRows.length !== 1 ||
    cloudRows[0].row.entity !== conflict.entity ||
    cloudRows[0].row.entityId !== conflict.entityId ||
    canonicalStringify(cloudRows[0].row.payload) !== canonicalStringify(cloudPayload) ||
    cloudRows[0].row.version !== conflict.cloudVersion
  ) {
    throw new Error('Generic conflict authority does not match its cloud payload')
  }
  return {
    conflict: { ...conflict, ownerId, cloudRows: cloudRows.map(({ row }) => row) },
    localPayloadJson: canonicalStringify(localPayload),
    cloudPayloadJson: canonicalStringify(cloudPayload),
    cloudRowsJson: canonicalStringify(cloudRows.map(({ row }) => row)),
  }
}

const prepareConflict = (
  input: ConflictRecord,
  ownerId: string,
): ReturnType<typeof prepareConflictUnchecked> => {
  try {
    return prepareConflictUnchecked(input, ownerId)
  } catch (cause) {
    if (cause instanceof DataCorruptionError) throw cause
    throw new DataCorruptionError('Conflict authority response is invalid', { cause })
  }
}

const writeConflict = async (
  database: SQLiteDatabase,
  ownerId: string,
  prepared: ReturnType<typeof prepareConflict>,
): Promise<void> => {
  const { conflict, localPayloadJson, cloudPayloadJson, cloudRowsJson } = prepared
  await database.runAsync(
    `/* conflicts:upsert */
     INSERT INTO conflicts
       (owner_id, mutation_id, entity, entity_id, local_payload_json,
        cloud_payload_json, cloud_version, cloud_rows_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_id, mutation_id) DO UPDATE SET
       entity = excluded.entity,
       entity_id = excluded.entity_id,
       local_payload_json = excluded.local_payload_json,
       cloud_payload_json = excluded.cloud_payload_json,
       cloud_version = excluded.cloud_version,
       cloud_rows_json = excluded.cloud_rows_json`,
    [
      ownerId,
      conflict.mutationId,
      conflict.entity,
      conflict.entityId,
      localPayloadJson,
      cloudPayloadJson,
      conflict.cloudVersion,
      cloudRowsJson,
    ],
  )
}

export const validateMutationEnvelope = (input: MutationEnvelope): MutationEnvelope => {
  const mutation = MutationEnvelopeSchema.parse(input) as MutationEnvelope
  if (mutation.kind === 'delete') {
    if (mutation.payload !== null) throw new Error('Delete mutations require a null tombstone payload')
    return mutation
  }

  if (mutation.kind === 'save_invoice_bundle') {
    if (mutation.entity !== 'invoice') {
      throw new Error('Invoice bundle mutations require entity invoice')
    }
    return {
      ...mutation,
      payload: validateBundlePayload(
        mutation.payload,
        mutation.ownerId,
        mutation.entityId,
      ),
    }
  }

  return {
    ...mutation,
    payload: validateEntityPayload(
      mutation.entity,
      mutation.payload,
      mutation.ownerId,
      mutation.entityId,
    ),
  }
}

export type SQLiteFieldCraftRepositoryOptions = {
  databaseName?: string
}

type RepositoryControlPlane = {
  ownerBoundary: OwnerBoundary
  ownerRequestGeneration: number
  clearPromises: Map<string, Promise<void>>
  clearingOwners: Set<string>
  failedClearOwners: Set<string>
  writeTail: Promise<void>
  attachments: Map<symbol, 'attached' | 'closing'>
  initialPullListeners: Map<string, Set<() => void>>
  localMutationListeners: Set<(ownerId: string) => void>
}

const databaseControlPlanes = new Map<string, RepositoryControlPlane>()

const getDatabaseControlPlane = (databaseName: string): RepositoryControlPlane => {
  const existing = databaseControlPlanes.get(databaseName)
  if (existing) return existing
  const controlPlane: RepositoryControlPlane = {
    ownerBoundary: new OwnerBoundary(),
    ownerRequestGeneration: 0,
    clearPromises: new Map(),
    clearingOwners: new Set(),
    failedClearOwners: new Set(),
    writeTail: Promise.resolve(),
    attachments: new Map(),
    initialPullListeners: new Map(),
    localMutationListeners: new Set(),
  }
  databaseControlPlanes.set(databaseName, controlPlane)
  return controlPlane
}

export class SQLiteFieldCraftRepository implements FieldCraftRepository {
  readonly ownerBoundary: OwnerBoundary
  readonly outbox: MutationOutbox

  private readonly databaseName: string
  private readonly control: RepositoryControlPlane
  private readonly attachmentToken = Symbol('fieldcraft-repository-attachment')
  private attached = false
  private database: SQLiteDatabase | null = null
  private openPromise: Promise<SQLiteDatabase> | null = null
  private closePromise: Promise<void> | null = null
  private closing = false
  private activeOperations = 0
  private drainWaiters: (() => void)[] = []
  private pendingWrites = 0
  private pendingWriteWaiters: (() => void)[] = []

  constructor(options: SQLiteFieldCraftRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? 'fieldcraft.db'
    this.control = getDatabaseControlPlane(this.databaseName)
    this.ownerBoundary = this.control.ownerBoundary
    this.outbox = new SQLiteMutationOutbox(
      this.accessDatabase,
      validateMutationEnvelope,
      this.ownerBoundary,
      this.assertOwnerAvailable,
    )
  }

  async initialize(ownerId: string): Promise<void> {
    if (!ownerId) throw new Error('An owner ID is required to initialize the repository')
    if (this.closing) throw new Error('The repository is closing or closed')
    const attachedNow = this.attach()
    try {
      const activeOwner = this.ownerBoundary.getSnapshot().ownerId
      if (activeOwner !== null && activeOwner !== ownerId) this.ownerBoundary.switchOwner(null)
      const generation = ++this.control.ownerRequestGeneration
      await this.ensureDatabase()
      if (this.closing) throw new Error('The repository is closing or closed')
      if (generation === this.control.ownerRequestGeneration) this.ownerBoundary.switchOwner(ownerId)
    } catch (error) {
      if (attachedNow && !this.closing && this.detach()) this.deactivateOwner()
      throw error
    }
  }

  deactivateOwner(): void {
    this.control.ownerRequestGeneration += 1
    this.ownerBoundary.switchOwner(null)
  }

  async list<T>(entity: EntityName): Promise<T[]> {
    EntityNameSchema.parse(entity)
    const snapshot = this.requireOwnerSnapshot()
    const rows = await this.accessDatabase((database) =>
      database.getAllAsync<RecordRow>(
        `/* records:list */
         SELECT entity_id, payload_json
         FROM records
         WHERE owner_id = ? AND entity = ? AND deleted = 0
         ORDER BY updated_at DESC, entity_id ASC`,
        [snapshot.ownerId, entity],
      ),
    )
    if (!this.ownerBoundary.isCurrent(snapshot)) return []
    return rows.map((row) =>
      this.parsePersistedPayload<T>(entity, row.payload_json, snapshot.ownerId, row.entity_id),
    )
  }

  async get<T>(entity: EntityName, id: string): Promise<T | null> {
    EntityNameSchema.parse(entity)
    if (!id) throw new Error('An entity ID is required')
    const snapshot = this.requireOwnerSnapshot()
    const row = await this.accessDatabase((database) =>
      database.getFirstAsync<RecordRow>(
        `/* records:get */
         SELECT entity_id, payload_json
         FROM records
         WHERE owner_id = ? AND entity = ? AND entity_id = ? AND deleted = 0`,
        [snapshot.ownerId, entity, id],
      ),
    )
    if (!this.ownerBoundary.isCurrent(snapshot) || !row) return null
    return this.parsePersistedPayload<T>(entity, row.payload_json, snapshot.ownerId, id)
  }

  async transactLocalMutation(input: MutationEnvelope): Promise<void> {
    const mutation = validateMutationEnvelope(input)
    const snapshot = this.requireOwnerSnapshot()
    if (mutation.ownerId !== snapshot.ownerId) {
      throw new Error('Mutation owner does not match the active repository owner')
    }
    let didWrite = false

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(mutation.ownerId)
      if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
        throw new Error('Owner changed while waiting to commit a local mutation')
      }
      const hash = await hashMutationEnvelope(mutation)
      const payloadJson = canonicalStringify(mutation.payload)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
        const duplicate = await transaction.getFirstAsync<ExistingMutationRow>(
          `/* outbox:duplicate */
           SELECT payload_hash FROM outbox WHERE owner_id = ? AND mutation_id = ?`,
          [mutation.ownerId, mutation.id],
        )
        if (duplicate) {
          if (duplicate.payload_hash !== hash) {
            throw new DataCorruptionError(
              `Mutation ID corruption: ${mutation.id} was reused with different canonical content`,
            )
          }
          return
        }

        const records = mutation.kind === 'save_invoice_bundle'
          ? [
              { entity: 'client' as const, payload: (mutation.payload as InvoiceBundlePayload).client },
              { entity: 'job' as const, payload: (mutation.payload as InvoiceBundlePayload).job },
              { entity: 'invoice' as const, payload: (mutation.payload as InvoiceBundlePayload).invoice },
            ]
          : [
              {
                entity: mutation.entity,
                payload: mutation.payload as Record<string, unknown> | null,
              },
            ]
        for (const record of records) {
          const deleted = mutation.kind === 'delete' ? 1 : 0
          const entityId = deleted ? mutation.entityId : String(record.payload?.id)
          const version = deleted
            ? (mutation.baseVersion ?? 0)
            : Number(record.payload?.version)
          const updatedAt = deleted ? mutation.createdAt : String(record.payload?.updatedAt)
          await transaction.runAsync(
            `/* records:upsert */
             INSERT INTO records
               (owner_id, entity, entity_id, payload_json, version, deleted, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
               payload_json = excluded.payload_json,
               version = excluded.version,
               deleted = excluded.deleted,
               updated_at = excluded.updated_at`,
            [
              mutation.ownerId,
              record.entity,
              entityId,
              canonicalStringify(record.payload),
              version,
              deleted,
              updatedAt,
            ],
          )
        }

        const sequence = await transaction.getFirstAsync<NextSequenceRow>(
          `/* outbox:next-sequence */
           SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
           FROM outbox WHERE owner_id = ?`,
          [mutation.ownerId],
        )
        await transaction.runAsync(
          `/* outbox:insert */
           INSERT INTO outbox
             (owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,
              payload_json, payload_hash, created_at, attempts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            mutation.ownerId,
            mutation.id,
            sequence?.next_sequence ?? 1,
            mutation.entity,
            mutation.entityId,
            mutation.kind,
            mutation.baseVersion,
            payloadJson,
            hash,
            mutation.createdAt,
            mutation.attempts,
          ],
        )
        didWrite = true

        if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
          throw new Error('Owner changed while committing a local mutation')
        }
        })
      }, true)
    })
    if (didWrite && this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
      this.emitLocalMutation(snapshot.ownerId)
    }
  }

  subscribeToLocalMutations(listener: (ownerId: string) => void): () => void {
    this.control.localMutationListeners.add(listener)
    return () => this.control.localMutationListeners.delete(listener)
  }

  async applyCloudRows(inputRows: CloudRowEnvelope[]): Promise<void> {
    const snapshot = this.requireOwnerSnapshot()
    const prepared = prepareCloudRows(inputRows, snapshot.ownerId)

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const positioned = prepared.every(({ row }) => row.changeSource !== undefined)
          if (positioned) await applyServerAuthorityAndOverlay(transaction, snapshot.ownerId, prepared)
          else await writeCloudRows(transaction, prepared)
          if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while applying cloud rows')
          }
        })
      }, true)
    })
    if (prepared.length > 0 && this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
    }
  }

  async markConflict(input: ConflictRecord): Promise<void> {
    const snapshot = this.requireOwnerSnapshot()
    const prepared = prepareConflict(input, snapshot.ownerId)

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await writeConflict(transaction, snapshot.ownerId, prepared)
          if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while recording a conflict')
          }
        })
      }, true)
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) this.ownerBoundary.markDataChanged()
  }

  async getSyncCursor(ownerId: string): Promise<string | null> {
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Sync cursor owner must match the active owner')
    const row = await this.accessDatabase((database) => database.getFirstAsync<SyncCursorRow>(
      `/* sync-cursors:get */
       SELECT cursor FROM sync_cursors WHERE owner_id = ? AND entity = ?`,
      [ownerId, '__all__'],
    ))
    return this.ownerBoundary.isCurrent(snapshot) ? row?.cursor ?? null : null
  }

  async commitPull(
    ownerId: string,
    inputRows: CloudRowEnvelope[],
    cursor: string,
    markInitialHydration = true,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!cursor) throw new Error('A durable pull cursor is required')
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Pull owner must match the active owner')
    const prepared = prepareCloudRows(inputRows, ownerId)
    requirePositionedRows(prepared, 'Pull commit')
    requireAuthoritySources(prepared, ['sync_changes'], 'Pull commit')
    parseSyncCursorTuple(cursor)
    let reconciledBootstrap = false
    let completedInitialHydration = false

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const reconciliation = await transaction.getFirstAsync<MetadataRow>(
            `/* metadata:reconciliation:get */
             SELECT value FROM metadata WHERE owner_id = ? AND key = ?`,
            [ownerId, FEED_RECONCILIATION_KEY],
          )
          if (reconciliation?.value === 'true') await writeBootstrapRows(transaction, prepared)
          else await applyServerAuthorityAndOverlay(transaction, ownerId, prepared)
          await transaction.runAsync(
            `/* sync-cursors:upsert */
             INSERT INTO sync_cursors (owner_id, entity, cursor)
             VALUES (?, ?, ?)
             ON CONFLICT(owner_id, entity) DO UPDATE SET cursor = excluded.cursor`,
            [ownerId, '__all__', cursor],
          )
          if (markInitialHydration) {
            if (reconciliation?.value === 'true') {
              completedInitialHydration = await finalizeBootstrapReconciliation(transaction, ownerId)
              reconciledBootstrap = true
            } else completedInitialHydration = true
            if (completedInitialHydration) {
              await transaction.runAsync(
                `/* metadata:initial-pull:upsert */
                 INSERT INTO metadata (owner_id, key, value)
                 VALUES (?, ?, ?)
                 ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`,
                [ownerId, 'initial-cloud-pull-complete', 'true'],
              )
            }
          }
          if (!isCurrent() || !this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while committing a pull')
          }
        })
      }, true)
    })
    if ((prepared.length > 0 || reconciledBootstrap) && this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
    }
    if (completedInitialHydration && this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      const listeners = this.control.initialPullListeners.get(ownerId)
      this.control.initialPullListeners.delete(ownerId)
      for (const listener of listeners ?? []) listener()
    }
  }

  async hasCompletedInitialPull(ownerId: string): Promise<boolean> {
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Hydration owner must match the active owner')
    const row = await this.accessDatabase((database) => database.getFirstAsync<MetadataRow>(
      `/* metadata:initial-pull:get */
       SELECT value FROM metadata WHERE owner_id = ? AND key = ?`,
      [ownerId, 'initial-cloud-pull-complete'],
    ))
    return this.ownerBoundary.isCurrent(snapshot) && row?.value === 'true'
  }

  async waitForInitialPull(ownerId: string): Promise<void> {
    if (await this.hasCompletedInitialPull(ownerId)) return
    await new Promise<void>((resolve, reject) => {
      const listeners = this.control.initialPullListeners.get(ownerId) ?? new Set<() => void>()
      const finish = () => {
        listeners.delete(finish)
        resolve()
      }
      listeners.add(finish)
      this.control.initialPullListeners.set(ownerId, listeners)
      void this.hasCompletedInitialPull(ownerId).then((completed) => {
        if (completed) finish()
      }).catch((error: unknown) => {
        listeners.delete(finish)
        reject(error)
      })
    })
  }

  async acknowledgeMutation(
    ownerId: string,
    mutationId: string,
    inputRows: CloudRowEnvelope[],
    isCurrent: () => boolean = () => true,
    requiresBootstrapRepair = false,
  ): Promise<void> {
    if (!mutationId) throw new Error('A mutation ID is required for acknowledgement')
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Acknowledgement owner must match the active owner')
    const prepared = prepareCloudRows(inputRows, ownerId)
    if (!requiresBootstrapRepair) {
      requirePositionedRows(prepared, 'Mutation acknowledgement')
      requireAuthoritySources(
        prepared,
        ['sync_changes', 'legacy_receipt'],
        'Mutation acknowledgement',
      )
    }
    let completedInitialHydration = false
    let scheduledBootstrapRepair = false

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          if (requiresBootstrapRepair) {
            if (prepared.length !== 0) {
              throw new DataCorruptionError('Legacy feed repair cannot include receipt rows')
            }
            const repairMutation = await transaction.getFirstAsync<{ entity: EntityName; kind: string }>(
              `/* outbox:legacy-feed-repair:get */
               SELECT entity, kind FROM outbox
               WHERE owner_id = ? AND mutation_id = ? AND state <> 'complete'`,
              [ownerId, mutationId],
            )
            if (
              repairMutation?.entity !== 'invoice' ||
              !['create', 'update'].includes(repairMutation.kind)
            ) {
              throw new DataCorruptionError('Legacy feed repair requires a pending invoice mutation')
            }
            const terminal = await transaction.getFirstAsync<MetadataRow>(
              `/* metadata:reconciliation-terminal:get */
               SELECT value FROM metadata WHERE owner_id = ? AND key = ?`,
              [ownerId, FEED_RECONCILIATION_TERMINAL_KEY],
            )
            if (terminal?.value !== 'true') {
              await scheduleFreshBootstrapReconciliation(transaction, ownerId)
              if (!isCurrent() || !this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
                throw new Error('Owner changed while scheduling legacy feed repair')
              }
              scheduledBootstrapRepair = true
              return
            }
          }
          if (!requiresBootstrapRepair) await writeServerAuthorityRows(transaction, prepared)
          const result = await transaction.runAsync(
            `/* outbox:acknowledge */
             UPDATE outbox SET state = 'complete', last_error = NULL
             WHERE owner_id = ? AND mutation_id = ?
               AND state IN ('pending', 'failed', 'syncing')`,
            [ownerId, mutationId],
          )
          if (result.changes !== 1) {
            throw new Error('Mutation acknowledgement did not match one sendable outbox record')
          }
          completedInitialHydration = requiresBootstrapRepair
            ? await finalizeBootstrapReconciliation(transaction, ownerId)
            : await repairAcknowledgedBootstrapRows(transaction, ownerId, prepared)
          if (requiresBootstrapRepair && completedInitialHydration) {
            await transaction.runAsync(
              `/* metadata:initial-pull:upsert */
               INSERT INTO metadata (owner_id, key, value)
               VALUES (?, ?, ?)
               ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value`,
              [ownerId, 'initial-cloud-pull-complete', 'true'],
            )
          }
          await materializeServerAuthority(transaction, ownerId)
          await overlayAllLocalIntents(transaction, ownerId)
          if (!isCurrent() || !this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while acknowledging a mutation')
          }
        })
      }, true)
    })
    if (scheduledBootstrapRepair) {
      throw new Error('Legacy feed repair scheduled a fresh bootstrap reconciliation')
    }
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
      if (completedInitialHydration) {
        const listeners = this.control.initialPullListeners.get(ownerId)
        this.control.initialPullListeners.delete(ownerId)
        for (const listener of listeners ?? []) listener()
      }
    }
  }

  async recordMutationFailure(
    ownerId: string,
    mutationId: string,
    inputReason: MutationFailureReason,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const reason = MutationFailureReasonSchema.parse(inputReason)
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Failure owner must match the active owner')
    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const result = await transaction.runAsync(
            `/* outbox:failure */
             UPDATE outbox
             SET state = 'failed', attempts = attempts + 1, last_error = ?
             WHERE owner_id = ? AND mutation_id = ?
               AND state IN ('pending', 'failed', 'syncing', 'conflict')`,
            [reason, ownerId, mutationId],
          )
          if (result.changes !== 1) throw new Error('Mutation failure did not match one outbox record')
          if (!isCurrent() || !this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while recording a mutation failure')
          }
        })
      }, true)
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) this.ownerBoundary.markDataChanged()
  }

  async recordMutationConflict(
    ownerId: string,
    input: ConflictRecord,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Conflict owner must match the active owner')
    const prepared = prepareConflict(input, ownerId)
    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await writeConflict(transaction, ownerId, prepared)
          const result = await transaction.runAsync(
            `/* outbox:conflict */
             UPDATE outbox SET state = 'conflict', last_error = NULL
             WHERE owner_id = ? AND mutation_id = ?
               AND state IN ('pending', 'failed', 'syncing')`,
            [ownerId, input.mutationId],
          )
          if (result.changes !== 1) throw new Error('Conflict did not match one outbox record')
          if (!isCurrent() || !this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while committing a conflict')
          }
        })
      }, true)
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) this.ownerBoundary.markDataChanged()
  }

  async countConflicts(ownerId: string): Promise<number> {
    const snapshot = this.requireOwnerSnapshot()
    if (ownerId !== snapshot.ownerId) throw new Error('Conflict owner must match the active owner')
    const row = await this.accessDatabase((database) => database.getFirstAsync<CountRow>(
      `/* conflicts:count */ SELECT COUNT(*) AS count FROM conflicts WHERE owner_id = ?`,
      [ownerId],
    ))
    return this.ownerBoundary.isCurrent(snapshot) ? row?.count ?? 0 : 0
  }

  async getConflict(mutationId: string): Promise<ConflictRecord | null> {
    if (!mutationId) throw new Error('A mutation ID is required')
    const snapshot = this.requireOwnerSnapshot()
    const row = await this.accessDatabase((database) => database.getFirstAsync<ConflictRow>(
      `/* conflicts:get */
       SELECT conflict.mutation_id, outbox.kind AS mutation_kind,
              conflict.entity, conflict.entity_id, conflict.local_payload_json,
              conflict.cloud_payload_json, conflict.cloud_version, conflict.cloud_rows_json
       FROM conflicts AS conflict
       INNER JOIN outbox AS outbox
         ON outbox.owner_id = conflict.owner_id
        AND outbox.mutation_id = conflict.mutation_id
       WHERE conflict.owner_id = ? AND conflict.mutation_id = ?`,
      [snapshot.ownerId, mutationId],
    ))
    if (!this.ownerBoundary.isCurrent(snapshot) || !row) return null
    return this.parseConflictRow(row, snapshot.ownerId)
  }

  async resolveConflictKeepCloud(mutationId: string): Promise<void> {
    const snapshot = this.requireOwnerSnapshot()
    let completedInitialHydration = false
    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const row = await transaction.getFirstAsync<ConflictRow>(
            `/* conflicts:get */
             SELECT conflict.mutation_id, outbox.kind AS mutation_kind,
                    conflict.entity, conflict.entity_id, conflict.local_payload_json,
                    conflict.cloud_payload_json, conflict.cloud_version, conflict.cloud_rows_json
             FROM conflicts AS conflict
             INNER JOIN outbox AS outbox
               ON outbox.owner_id = conflict.owner_id
              AND outbox.mutation_id = conflict.mutation_id
             WHERE conflict.owner_id = ? AND conflict.mutation_id = ?`,
            [snapshot.ownerId, mutationId],
          )
          if (!row) throw new Error('The conflict is no longer available')
          const conflict = this.parseConflictRow(row, snapshot.ownerId)
          const preparedCloudRows = prepareCloudRows(conflict.cloudRows, snapshot.ownerId)
          requirePositionedRows(preparedCloudRows, 'Keep-cloud conflict resolution')
          await writeServerAuthorityRows(transaction, preparedCloudRows)
          const completed = await transaction.runAsync(
            `/* outbox:resolve */
             UPDATE outbox SET state = 'complete', last_error = NULL
             WHERE owner_id = ? AND mutation_id = ? AND state = 'conflict'`,
            [snapshot.ownerId, mutationId],
          )
          if (completed.changes !== 1) throw new Error('Conflict resolution did not match its outbox record')
          completedInitialHydration = await repairAcknowledgedBootstrapRows(
            transaction,
            snapshot.ownerId,
            preparedCloudRows,
          )
          await materializeServerAuthority(transaction, snapshot.ownerId)
          await overlayAllLocalIntents(transaction, snapshot.ownerId)
          await transaction.runAsync(
            `/* conflicts:delete */ DELETE FROM conflicts WHERE owner_id = ? AND mutation_id = ?`,
            [snapshot.ownerId, mutationId],
          )
          if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while resolving a conflict')
          }
        })
      }, true)
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
      if (completedInitialHydration) {
        const listeners = this.control.initialPullListeners.get(snapshot.ownerId)
        this.control.initialPullListeners.delete(snapshot.ownerId)
        for (const listener of listeners ?? []) listener()
      }
    }
  }

  async resolveConflictWithMutation(
    originalMutationId: string,
    inputReplacement: MutationEnvelope,
  ): Promise<void> {
    const replacement = validateMutationEnvelope(inputReplacement)
    if (!['create', 'update', 'delete', 'save_invoice_bundle'].includes(replacement.kind)) {
      throw new Error('Conflict edits require a create, update, delete, or invoice bundle mutation')
    }
    if (replacement.id === originalMutationId) throw new Error('Conflict edits require a new mutation ID')
    const snapshot = this.requireOwnerSnapshot()
    if (replacement.ownerId !== snapshot.ownerId) {
      throw new Error('Conflict replacement owner must match the active owner')
    }
    const hash = await hashMutationEnvelope(replacement)
    const payloadJson = canonicalStringify(replacement.payload)

    await this.serializeWrite(async () => {
      this.assertSharedOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          const conflictRow = await transaction.getFirstAsync<ConflictRow>(
            `/* conflicts:get */
             SELECT conflict.mutation_id, outbox.kind AS mutation_kind,
                    conflict.entity, conflict.entity_id, conflict.local_payload_json,
                    conflict.cloud_payload_json, conflict.cloud_version, conflict.cloud_rows_json
             FROM conflicts AS conflict
             INNER JOIN outbox AS outbox
               ON outbox.owner_id = conflict.owner_id
              AND outbox.mutation_id = conflict.mutation_id
             WHERE conflict.owner_id = ? AND conflict.mutation_id = ?`,
            [snapshot.ownerId, originalMutationId],
          )
          if (!conflictRow) throw new Error('The conflict is no longer available')
          const conflict = this.parseConflictRow(conflictRow, snapshot.ownerId)
          const expectedKind = conflict.mutationKind === 'create'
            ? 'update'
            : conflict.mutationKind === 'update' && conflict.cloudPayload === null
              ? 'create'
              : conflict.mutationKind ?? 'update'
          const expectedBaseVersion = expectedKind === 'create' ? null : conflict.cloudVersion
          if (
            replacement.entity !== conflict.entity ||
            replacement.entityId !== conflict.entityId ||
            replacement.baseVersion !== expectedBaseVersion ||
            replacement.kind !== expectedKind
          ) {
            throw new Error('Conflict replacement must target the current cloud version')
          }
          const duplicate = await transaction.getFirstAsync<ExistingMutationRow>(
            `/* outbox:duplicate */
             SELECT payload_hash FROM outbox WHERE owner_id = ? AND mutation_id = ?`,
            [replacement.ownerId, replacement.id],
          )
          if (duplicate) throw new DataCorruptionError('Conflict replacement mutation ID already exists')

          const records = replacement.kind === 'save_invoice_bundle'
            ? (['client', 'job', 'invoice'] as const).map((entity) => ({
                entity,
                payload: (replacement.payload as InvoiceBundlePayload)[entity],
              }))
            : [{ entity: replacement.entity, payload: replacement.payload as Record<string, unknown> | null }]
          for (const record of records) {
            const deleted = replacement.kind === 'delete'
            const entityId = deleted ? replacement.entityId : String(record.payload?.id)
            await transaction.runAsync(
              `/* records:upsert */
               INSERT INTO records
                 (owner_id, entity, entity_id, payload_json, version, deleted, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 version = excluded.version,
                 deleted = excluded.deleted,
                 updated_at = excluded.updated_at`,
              [
                replacement.ownerId,
                record.entity,
                entityId,
                canonicalStringify(record.payload),
                deleted ? replacement.baseVersion ?? 0 : Number(record.payload?.version),
                deleted ? 1 : 0,
                deleted ? replacement.createdAt : String(record.payload?.updatedAt),
              ],
            )
          }
          const sequence = await transaction.getFirstAsync<NextSequenceRow>(
            `/* outbox:next-sequence */
             SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
             FROM outbox WHERE owner_id = ?`,
            [replacement.ownerId],
          )
          await transaction.runAsync(
            `/* outbox:insert */
             INSERT INTO outbox
               (owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,
                payload_json, payload_hash, created_at, attempts)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              replacement.ownerId,
              replacement.id,
              sequence?.next_sequence ?? 1,
              replacement.entity,
              replacement.entityId,
              replacement.kind,
              replacement.baseVersion,
              payloadJson,
              hash,
              replacement.createdAt,
              replacement.attempts,
            ],
          )
          const completed = await transaction.runAsync(
            `/* outbox:resolve */
             UPDATE outbox SET state = 'complete', last_error = NULL
             WHERE owner_id = ? AND mutation_id = ? AND state = 'conflict'`,
            [snapshot.ownerId, originalMutationId],
          )
          if (completed.changes !== 1) throw new Error('Conflict resolution did not match its outbox record')
          await transaction.runAsync(
            `/* conflicts:delete */ DELETE FROM conflicts WHERE owner_id = ? AND mutation_id = ?`,
            [snapshot.ownerId, originalMutationId],
          )
          if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
            throw new Error('Owner changed while replacing a conflict mutation')
          }
        })
      }, true)
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
      this.emitLocalMutation(snapshot.ownerId)
    }
  }

  clearOwner(ownerId: string): Promise<void> {
    if (!ownerId) return Promise.reject(new Error('An owner ID is required to clear data'))
    if (this.closing) return Promise.reject(new Error('The repository is closing or closed'))
    const existing = this.control.clearPromises.get(ownerId)
    if (existing) return existing

    this.control.clearingOwners.add(ownerId)
    this.ownerBoundary.beginDelete(ownerId)
    const clear = this.serializeWrite(async () => {
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
          await transaction.runAsync('/* owner:clear:records */ DELETE FROM records WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:outbox */ DELETE FROM outbox WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:conflicts */ DELETE FROM conflicts WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:sync_cursors */ DELETE FROM sync_cursors WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:sync_bootstrap_records */ DELETE FROM sync_bootstrap_records WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:sync_server_authority */ DELETE FROM sync_server_authority WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:sync_change_events */ DELETE FROM sync_change_events WHERE owner_id = ?', [ownerId])
          await transaction.runAsync('/* owner:clear:metadata */ DELETE FROM metadata WHERE owner_id = ?', [ownerId])
        })
      }, true)
      this.control.failedClearOwners.delete(ownerId)
    }).catch((error) => {
      this.control.failedClearOwners.add(ownerId)
      throw error
    }).finally(() => {
      const hydrationListeners = this.control.initialPullListeners.get(ownerId)
      this.control.initialPullListeners.delete(ownerId)
      for (const listener of hydrationListeners ?? []) listener()
      this.control.clearingOwners.delete(ownerId)
      this.control.clearPromises.delete(ownerId)
    })
    this.control.clearPromises.set(ownerId, clear)
    return clear
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    if (this.attached) this.control.attachments.set(this.attachmentToken, 'closing')
    this.closePromise = (async () => {
      if (this.openPromise) {
        try {
          await this.openPromise
        } catch {
          // Opening already reports its own failure to the initiating caller.
        }
      }
      if (this.pendingWrites > 0) {
        await new Promise<void>((resolve) => this.pendingWriteWaiters.push(resolve))
      }
      if (this.activeOperations > 0) {
        await new Promise<void>((resolve) => this.drainWaiters.push(resolve))
      }
      const database = this.database
      this.database = null
      try {
        if (database) await database.closeAsync()
      } finally {
        if (this.detach()) this.deactivateOwner()
      }
    })()
    return this.closePromise
  }

  private requireOwnerSnapshot() {
    const snapshot = this.ownerBoundary.capture()
    if (!snapshot.ownerId) throw new Error('The repository has no active owner')
    this.assertOwnerAvailable(snapshot.ownerId)
    return snapshot as typeof snapshot & { ownerId: string }
  }

  private assertOwnerAvailable = (ownerId: string): void => {
    if (this.closing) throw new Error('The repository is closing or closed')
    this.assertSharedOwnerAvailable(ownerId)
  }

  private assertSharedOwnerAvailable = (ownerId: string): void => {
    if (this.control.clearingOwners.has(ownerId)) {
      throw new Error(`Owner ${ownerId} data clear is in progress`)
    }
    if (this.control.failedClearOwners.has(ownerId)) {
      throw new Error(`Owner ${ownerId} data clear failed; retry clearOwner before access`)
    }
  }

  private serializeWrite = <T>(work: () => Promise<T>): Promise<T> => {
    this.pendingWrites += 1
    const run = this.control.writeTail.then(work, work)
    this.control.writeTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run.finally(() => {
      this.pendingWrites -= 1
      if (this.pendingWrites === 0) {
        const waiters = this.pendingWriteWaiters
        this.pendingWriteWaiters = []
        for (const waiter of waiters) waiter()
      }
    })
  }

  private emitLocalMutation(ownerId: string): void {
    for (const listener of this.control.localMutationListeners) listener(ownerId)
  }

  private attach(): boolean {
    if (this.attached) return false
    this.attached = true
    this.control.attachments.set(this.attachmentToken, 'attached')
    return true
  }

  private detach(): boolean {
    if (!this.attached) return false
    this.attached = false
    this.control.attachments.delete(this.attachmentToken)
    return this.control.attachments.size === 0
  }

  private parseConflictRow(row: ConflictRow, ownerId: string): ConflictRecord {
    try {
      return prepareConflict({
        mutationId: row.mutation_id,
        ownerId,
        mutationKind: row.mutation_kind,
        entity: row.entity,
        entityId: row.entity_id,
        localPayload: JSON.parse(row.local_payload_json),
        cloudPayload: JSON.parse(row.cloud_payload_json),
        cloudVersion: row.cloud_version,
        cloudRows: row.cloud_rows_json === null
          ? []
          : JSON.parse(row.cloud_rows_json),
      }, ownerId).conflict
    } catch (cause) {
      throw new DataCorruptionError(
        `Corrupt conflict record for owner ${ownerId} mutation ${row.mutation_id}`,
        { cause },
      )
    }
  }

  private parsePersistedPayload<T>(
    entity: EntityName,
    payloadJson: string,
    ownerId: string,
    entityId?: string,
  ): T {
    let payload: unknown
    try {
      payload = JSON.parse(payloadJson)
    } catch (cause) {
      throw new DataCorruptionError(`Corrupt cached JSON for owner ${ownerId} entity ${entity}`, {
        cause,
      })
    }

    try {
      const parsed = validateEntityPayload(
        entity,
        payload,
        ownerId,
        entityId ?? String((payload as Record<string, unknown> | null)?.id ?? ''),
      )
      return parsed as T
    } catch (cause) {
      throw new DataCorruptionError(
        `Corrupt cached payload for owner ${ownerId} entity ${entity}`,
        { cause },
      )
    }
  }

  private ensureDatabase = async (): Promise<SQLiteDatabase> => {
    if (this.database) return this.database
    if (this.closing) throw new Error('The repository is closing or closed')
    if (!this.openPromise) {
      this.openPromise = openFieldCraftDatabase(this.databaseName)
        .then(async (database) => {
          try {
            await applyMigrations(database)
            this.database = database
            return database
          } catch (error) {
            await database.closeAsync()
            throw error
          }
        })
        .catch((error) => {
          this.openPromise = null
          throw error
        })
    }
    return this.openPromise
  }

  private accessDatabase = async <T>(
    work: (database: SQLiteDatabase) => Promise<T>,
    allowClosing = false,
  ): Promise<T> => {
    if (this.closing && !allowClosing) throw new Error('The repository is closing or closed')
    if (!this.database && !this.openPromise) throw new Error('The repository has not been initialized')
    this.activeOperations += 1
    try {
      const database = await this.ensureDatabase()
      return await work(database)
    } finally {
      this.activeOperations -= 1
      if (this.activeOperations === 0) {
        const waiters = this.drainWaiters
        this.drainWaiters = []
        for (const waiter of waiters) waiter()
      }
    }
  }
}
