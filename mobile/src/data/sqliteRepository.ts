import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import { z } from 'zod'

import type { ConflictRecord, EntityName, MutationEnvelope } from '../domain/sync'
import { InvoiceDraftSchema } from '../domain/invoice'
import { MAX_MONEY_CENTS } from '../domain/limits'
import { openFieldCraftDatabase } from './database'
import { applyMigrations } from './migrations'
import { SQLiteMutationOutbox, type MutationOutbox } from './outbox'
import { OwnerBoundary } from './ownerBoundary'
import {
  DataCorruptionError,
  type CloudRowEnvelope,
  type FieldCraftRepository,
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
  payload_json: string
}

type ExistingMutationRow = {
  payload_hash: string
}

type NextSequenceRow = {
  next_sequence: number
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson }

const normalizeCanonicalJson = (value: unknown, ancestors: Set<object>): CanonicalJson => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers')
    return value
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError('Canonical JSON rejects cyclic arrays')
    const nextAncestors = new Set(ancestors).add(value)
    return value.map((item) => {
      if (item === undefined) throw new TypeError('Canonical JSON rejects undefined array items')
      return normalizeCanonicalJson(item, nextAncestors)
    })
  }
  if (typeof value === 'object' && value !== null) {
    if (ancestors.has(value)) throw new TypeError('Canonical JSON rejects cyclic objects')
    const nextAncestors = new Set(ancestors).add(value)
    const result: { [key: string]: CanonicalJson } = {}
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== undefined) result[key] = normalizeCanonicalJson(child, nextAncestors)
    }
    return result
  }
  throw new TypeError(`Canonical JSON rejects ${typeof value} values`)
}

const canonicalStringify = (value: unknown): string =>
  JSON.stringify(normalizeCanonicalJson(value, new Set()))

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
  return parsed
}

export const validateMutationEnvelope = (input: MutationEnvelope): MutationEnvelope => {
  const mutation = MutationEnvelopeSchema.parse(input) as MutationEnvelope
  if (mutation.kind === 'delete') {
    if (mutation.payload !== null) throw new Error('Delete mutations require a null tombstone payload')
    return mutation
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

const mutationHash = async (mutation: MutationEnvelope): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, canonicalStringify(mutation))

export type SQLiteFieldCraftRepositoryOptions = {
  databaseName?: string
}

export class SQLiteFieldCraftRepository implements FieldCraftRepository {
  readonly ownerBoundary = new OwnerBoundary()
  readonly outbox: MutationOutbox

  private readonly databaseName: string
  private database: SQLiteDatabase | null = null
  private openPromise: Promise<SQLiteDatabase> | null = null
  private closePromise: Promise<void> | null = null
  private closing = false
  private activeOperations = 0
  private drainWaiters: (() => void)[] = []
  private ownerRequestGeneration = 0
  private readonly clearPromises = new Map<string, Promise<void>>()

  constructor(options: SQLiteFieldCraftRepositoryOptions = {}) {
    this.databaseName = options.databaseName ?? 'fieldcraft.db'
    this.outbox = new SQLiteMutationOutbox(this.accessDatabase, validateMutationEnvelope)
  }

  async initialize(ownerId: string): Promise<void> {
    if (!ownerId) throw new Error('An owner ID is required to initialize the repository')
    if (this.closing) throw new Error('The repository is closing or closed')
    const activeOwner = this.ownerBoundary.getSnapshot().ownerId
    if (activeOwner !== null && activeOwner !== ownerId) this.ownerBoundary.switchOwner(null)
    const generation = ++this.ownerRequestGeneration
    await this.ensureDatabase()
    if (this.closing) throw new Error('The repository is closing or closed')
    if (generation === this.ownerRequestGeneration) this.ownerBoundary.switchOwner(ownerId)
  }

  deactivateOwner(): void {
    this.ownerRequestGeneration += 1
    this.ownerBoundary.switchOwner(null)
  }

  async list<T>(entity: EntityName): Promise<T[]> {
    EntityNameSchema.parse(entity)
    const snapshot = this.requireOwnerSnapshot()
    const rows = await this.accessDatabase((database) =>
      database.getAllAsync<RecordRow>(
        `/* records:list */
         SELECT payload_json
         FROM records
         WHERE owner_id = ? AND entity = ? AND deleted = 0
         ORDER BY updated_at DESC, entity_id ASC`,
        [snapshot.ownerId, entity],
      ),
    )
    if (!this.ownerBoundary.isCurrent(snapshot)) return []
    return rows.map((row) => this.parsePersistedPayload<T>(entity, row.payload_json, snapshot.ownerId))
  }

  async get<T>(entity: EntityName, id: string): Promise<T | null> {
    EntityNameSchema.parse(entity)
    if (!id) throw new Error('An entity ID is required')
    const snapshot = this.requireOwnerSnapshot()
    const row = await this.accessDatabase((database) =>
      database.getFirstAsync<RecordRow>(
        `/* records:get */
         SELECT payload_json
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
    const hash = await mutationHash(mutation)
    const payloadJson = canonicalStringify(mutation.payload)
    let didWrite = false

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

        const deleted = mutation.kind === 'delete' ? 1 : 0
        const payloadVersion =
          mutation.kind === 'delete'
            ? (mutation.baseVersion ?? 0)
            : Number((mutation.payload as Record<string, unknown>).version)
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
            mutation.entity,
            mutation.entityId,
            payloadJson,
            payloadVersion,
            deleted,
            mutation.createdAt,
          ],
        )

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

        if (!this.ownerBoundary.isCurrent(snapshot)) {
          throw new Error('Owner changed while committing a local mutation')
        }
      })
    })
    if (didWrite && this.ownerBoundary.isCurrent(snapshot)) this.ownerBoundary.markDataChanged()
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
        if (!this.ownerBoundary.isCurrent(snapshot)) {
          throw new Error('Owner changed while applying cloud rows')
        }
      })
    })
    if (prepared.length > 0 && this.ownerBoundary.isCurrent(snapshot)) {
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
        if (!this.ownerBoundary.isCurrent(snapshot)) {
          throw new Error('Owner changed while recording a conflict')
        }
      })
    })
    if (this.ownerBoundary.isCurrent(snapshot)) this.ownerBoundary.markDataChanged()
  }

  clearOwner(ownerId: string): Promise<void> {
    if (!ownerId) return Promise.reject(new Error('An owner ID is required to clear data'))
    const existing = this.clearPromises.get(ownerId)
    if (existing) return existing

    this.ownerBoundary.beginDelete(ownerId)
    const clear = this.accessDatabase(async (database) => {
      await database.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.runAsync('/* owner:clear:records */ DELETE FROM records WHERE owner_id = ?', [ownerId])
        await transaction.runAsync('/* owner:clear:outbox */ DELETE FROM outbox WHERE owner_id = ?', [ownerId])
        await transaction.runAsync('/* owner:clear:conflicts */ DELETE FROM conflicts WHERE owner_id = ?', [ownerId])
        await transaction.runAsync('/* owner:clear:sync_cursors */ DELETE FROM sync_cursors WHERE owner_id = ?', [ownerId])
        await transaction.runAsync('/* owner:clear:metadata */ DELETE FROM metadata WHERE owner_id = ?', [ownerId])
      })
    }).finally(() => {
      this.clearPromises.delete(ownerId)
    })
    this.clearPromises.set(ownerId, clear)
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
    return snapshot as typeof snapshot & { ownerId: string }
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
      const parsed = entityPayloadSchemas[entity].parse(payload) as Record<string, unknown>
      if (parsed.ownerId !== ownerId || (entityId !== undefined && parsed.id !== entityId)) {
        throw new Error('Persisted entity identity does not match its owner-scoped cache key')
      }
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
  ): Promise<T> => {
    if (this.closing) throw new Error('The repository is closing or closed')
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
