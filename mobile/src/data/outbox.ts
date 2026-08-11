import * as Crypto from 'expo-crypto'
import type { SQLiteDatabase } from 'expo-sqlite'

import type { MutationEnvelope } from '../domain/sync'
import type { OwnerBoundary } from './ownerBoundary'
import { OutboxCorruptionError } from './repository'

export interface MutationOutbox {
  list(ownerId: string): Promise<MutationEnvelope[]>
}

type OutboxRow = {
  owner_id: string
  mutation_id: string
  entity: MutationEnvelope['entity']
  entity_id: string
  kind: MutationEnvelope['kind']
  base_version: number | null
  payload_json: string
  created_at: string
  attempts: number
  payload_hash: string
  last_error: MutationEnvelope['failureReason'] | null
}

type DatabaseAccess = <T>(work: (database: SQLiteDatabase) => Promise<T>) => Promise<T>
type MutationValidator = (mutation: MutationEnvelope) => MutationEnvelope
type OwnerGuard = (ownerId: string) => void

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson }

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

export const canonicalStringify = (value: unknown): string =>
  JSON.stringify(normalizeCanonicalJson(value, new Set()))

const immutableMutationContent = (mutation: MutationEnvelope) => ({
  id: mutation.id,
  ownerId: mutation.ownerId,
  entity: mutation.entity,
  entityId: mutation.entityId,
  kind: mutation.kind,
  baseVersion: mutation.baseVersion,
  payload: mutation.payload,
  createdAt: mutation.createdAt,
})

export const hashMutationEnvelope = async (mutation: MutationEnvelope): Promise<string> =>
  Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalStringify(immutableMutationContent(mutation)),
  )

export class SQLiteMutationOutbox implements MutationOutbox {
  constructor(
    private readonly accessDatabase: DatabaseAccess,
    private readonly validateMutation: MutationValidator,
    private readonly ownerBoundary: OwnerBoundary,
    private readonly assertOwnerAvailable: OwnerGuard,
  ) {}

  async list(ownerId: string): Promise<MutationEnvelope[]> {
    if (!ownerId) throw new Error('An owner ID is required to read the outbox')
    this.assertOwnerAvailable(ownerId)
    const snapshot = this.ownerBoundary.capture()
    if (snapshot.ownerId !== ownerId) {
      throw new Error('Outbox owner must match the active owner')
    }

    const mutations = await this.accessDatabase(async (database) => {
      const rows = await database.getAllAsync<OutboxRow>(
        `/* outbox:list */
         SELECT owner_id, mutation_id, entity, entity_id, kind, base_version,
                payload_json, payload_hash, created_at, attempts, last_error
         FROM outbox AS candidate
         WHERE candidate.owner_id = ? AND candidate.state IN ('pending', 'failed')
           AND NOT EXISTS (
             SELECT 1
             FROM outbox_dependencies AS dependency
             INNER JOIN quarantined_outbox AS blocked
               ON blocked.owner_id = dependency.owner_id
              AND blocked.mutation_id = dependency.depends_on_mutation_id
              AND blocked.superseded_by IS NULL
             WHERE dependency.owner_id = candidate.owner_id
               AND dependency.mutation_id = candidate.mutation_id
           )
         ORDER BY candidate.sequence ASC`,
        [ownerId],
      )

      return Promise.all(rows.map(async (row) => {
        try {
          const payload: unknown = JSON.parse(row.payload_json)
          const mutation = this.validateMutation({
            id: row.mutation_id,
            ownerId: row.owner_id,
            entity: row.entity,
            entityId: row.entity_id,
            kind: row.kind,
            baseVersion: row.base_version,
            payload,
            createdAt: row.created_at,
            attempts: row.attempts,
          })
          const expectedHash = await hashMutationEnvelope(mutation)
          if (expectedHash !== row.payload_hash) {
            throw new OutboxCorruptionError(row.mutation_id)
          }
          return row.last_error ? { ...mutation, failureReason: row.last_error } : mutation
        } catch (cause) {
          if (row.last_error === 'invalid-response') {
            return {
              id: row.mutation_id,
              ownerId: row.owner_id,
              entity: row.entity,
              entityId: row.entity_id,
              kind: row.kind,
              baseVersion: row.base_version,
              payload: null,
              createdAt: row.created_at,
              attempts: row.attempts,
              failureReason: 'invalid-response' as const,
            }
          }
          if (cause instanceof OutboxCorruptionError) throw cause
          throw new OutboxCorruptionError(row.mutation_id, undefined, { cause })
        }
      }))
    })
    return this.ownerBoundary.isCurrent(snapshot) ? mutations : []
  }
}
