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
import {
  DataCorruptionError,
  type CloudRowEnvelope,
  type FieldCraftRepository,
  type InvoiceBundlePayload,
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
  client: VersionedEntitySchema.extend({ name: z.string().min(1) }),
  job: VersionedEntitySchema.extend({
    clientId: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(['Scheduled', 'In Progress', 'Invoiced', 'Paid']),
  }),
  invoice: VersionedEntitySchema.extend({
    clientId: z.string().min(1),
    jobId: z.string().min(1).optional(),
    draft: InvoiceDraftSchema,
    subtotalCents: MoneySchema,
    taxCents: MoneySchema,
    totalCents: MoneySchema,
  }),
  expense: VersionedEntitySchema.extend({ amountCents: MoneySchema }),
  service: VersionedEntitySchema.extend({ name: z.string().min(1), unitPriceCents: MoneySchema }),
  inventory: VersionedEntitySchema.extend({
    name: z.string().min(1),
    unitPriceCents: MoneySchema,
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
    deleted: z.boolean().optional(),
  })
  .strict()

const ConflictRecordSchema = z
  .object({
    mutationId: z.uuid(),
    entity: EntityNameSchema,
    entityId: z.string().min(1),
    localPayload: z.unknown(),
    cloudPayload: z.unknown(),
    cloudVersion: z.number().finite().int().min(0),
  })
  .strict()

type RecordRow = {
  entity_id: string
  payload_json: string
}

type ExistingMutationRow = {
  payload_hash: string
}

type NextSequenceRow = {
  next_sequence: number
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
  }
  databaseControlPlanes.set(databaseName, controlPlane)
  return controlPlane
}

export class SQLiteFieldCraftRepository implements FieldCraftRepository {
  readonly ownerBoundary: OwnerBoundary
  readonly outbox: MutationOutbox

  private readonly databaseName: string
  private readonly control: RepositoryControlPlane
  private database: SQLiteDatabase | null = null
  private openPromise: Promise<SQLiteDatabase> | null = null
  private closePromise: Promise<void> | null = null
  private closing = false
  private activeOperations = 0
  private drainWaiters: (() => void)[] = []

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
    const activeOwner = this.ownerBoundary.getSnapshot().ownerId
    if (activeOwner !== null && activeOwner !== ownerId) this.ownerBoundary.switchOwner(null)
    const generation = ++this.control.ownerRequestGeneration
    await this.ensureDatabase()
    if (this.closing) throw new Error('The repository is closing or closed')
    if (generation === this.control.ownerRequestGeneration) this.ownerBoundary.switchOwner(ownerId)
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
    const hash = await hashMutationEnvelope(mutation)
    const payloadJson = canonicalStringify(mutation.payload)
    let didWrite = false

    await this.serializeWrite(async () => {
      this.assertOwnerAvailable(mutation.ownerId)
      if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
        throw new Error('Owner changed while waiting to commit a local mutation')
      }
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
    }
  }

  async applyCloudRows(inputRows: CloudRowEnvelope[]): Promise<void> {
    const snapshot = this.requireOwnerSnapshot()
    const rows = inputRows.map((row) => CloudRowEnvelopeSchema.parse(row) as CloudRowEnvelope)
    const prepared = rows.map((row) => {
      if (row.ownerId !== snapshot.ownerId) {
        throw new Error('Cloud row owner does not match the active repository owner')
      }
      if (row.deleted && row.payload !== null) {
        throw new Error('Deleted cloud rows require a null tombstone payload')
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

    await this.serializeWrite(async () => {
      this.assertOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
        for (const { row, payloadJson } of prepared) {
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
            [row.ownerId, row.entity, row.entityId, payloadJson, row.version, row.deleted ? 1 : 0, row.updatedAt],
          )
        }
        if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
          throw new Error('Owner changed while applying cloud rows')
        }
        })
      })
    })
    if (prepared.length > 0 && this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
      this.ownerBoundary.markDataChanged()
    }
  }

  async markConflict(input: ConflictRecord): Promise<void> {
    const conflict = ConflictRecordSchema.parse(input) as ConflictRecord
    const snapshot = this.requireOwnerSnapshot()
    const localPayload = validateEntityPayload(
      conflict.entity,
      conflict.localPayload,
      snapshot.ownerId,
      conflict.entityId,
    )
    const cloudPayload = validateEntityPayload(
      conflict.entity,
      conflict.cloudPayload,
      snapshot.ownerId,
      conflict.entityId,
    )
    if (cloudPayload.version !== conflict.cloudVersion) {
      throw new Error('Conflict cloud payload version must match the conflict record')
    }
    const localPayloadJson = canonicalStringify(localPayload)
    const cloudPayloadJson = canonicalStringify(cloudPayload)

    await this.serializeWrite(async () => {
      this.assertOwnerAvailable(snapshot.ownerId)
      await this.accessDatabase(async (database) => {
        await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync(
          `/* conflicts:upsert */
           INSERT INTO conflicts
             (owner_id, mutation_id, entity, entity_id, local_payload_json,
              cloud_payload_json, cloud_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_id, mutation_id) DO UPDATE SET
             entity = excluded.entity,
             entity_id = excluded.entity_id,
             local_payload_json = excluded.local_payload_json,
             cloud_payload_json = excluded.cloud_payload_json,
             cloud_version = excluded.cloud_version`,
          [
            snapshot.ownerId,
            conflict.mutationId,
            conflict.entity,
            conflict.entityId,
            localPayloadJson,
            cloudPayloadJson,
            conflict.cloudVersion,
          ],
        )
        if (!this.ownerBoundary.isOwnerEpochCurrent(snapshot)) {
          throw new Error('Owner changed while recording a conflict')
        }
        })
      })
    })
    if (this.ownerBoundary.isOwnerEpochCurrent(snapshot)) this.ownerBoundary.markDataChanged()
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
          await transaction.runAsync('/* owner:clear:metadata */ DELETE FROM metadata WHERE owner_id = ?', [ownerId])
        })
      }, true)
      this.control.failedClearOwners.delete(ownerId)
    }).catch((error) => {
      this.control.failedClearOwners.add(ownerId)
      throw error
    }).finally(() => {
      this.control.clearingOwners.delete(ownerId)
      this.control.clearPromises.delete(ownerId)
    })
    this.control.clearPromises.set(ownerId, clear)
    return clear
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closing = true
    this.deactivateOwner()
    this.closePromise = (async () => {
      if (this.openPromise) {
        try {
          await this.openPromise
        } catch {
          // Opening already reports its own failure to the initiating caller.
        }
      }
      await this.control.writeTail
      if (this.activeOperations > 0) {
        await new Promise<void>((resolve) => this.drainWaiters.push(resolve))
      }
      const database = this.database
      this.database = null
      if (database) await database.closeAsync()
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
    if (this.control.clearingOwners.has(ownerId)) {
      throw new Error(`Owner ${ownerId} data clear is in progress`)
    }
    if (this.control.failedClearOwners.has(ownerId)) {
      throw new Error(`Owner ${ownerId} data clear failed; retry clearOwner before access`)
    }
  }

  private serializeWrite = <T>(work: () => Promise<T>): Promise<T> => {
    const run = this.control.writeTail.then(work, work)
    this.control.writeTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
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
