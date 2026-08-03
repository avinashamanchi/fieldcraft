import type { SQLiteDatabase } from 'expo-sqlite'

import type { MutationEnvelope } from '../domain/sync'
import { DataCorruptionError } from './repository'

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
}

type DatabaseAccess = <T>(work: (database: SQLiteDatabase) => Promise<T>) => Promise<T>
type MutationValidator = (mutation: MutationEnvelope) => MutationEnvelope

export class SQLiteMutationOutbox implements MutationOutbox {
  constructor(
    private readonly accessDatabase: DatabaseAccess,
    private readonly validateMutation: MutationValidator,
  ) {}

  async list(ownerId: string): Promise<MutationEnvelope[]> {
    if (!ownerId) throw new Error('An owner ID is required to read the outbox')

    return this.accessDatabase(async (database) => {
      const rows = await database.getAllAsync<OutboxRow>(
        `/* outbox:list */
         SELECT owner_id, mutation_id, entity, entity_id, kind, base_version,
                payload_json, created_at, attempts
         FROM outbox
         WHERE owner_id = ? AND state IN ('pending', 'failed')
         ORDER BY sequence ASC`,
        [ownerId],
      )

      return rows.map((row) => {
        let payload: unknown
        try {
          payload = JSON.parse(row.payload_json)
        } catch (cause) {
          throw new DataCorruptionError(
            `Corrupt outbox JSON for owner ${ownerId} mutation ${row.mutation_id}`,
            { cause },
          )
        }

        try {
          return this.validateMutation({
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
        } catch (cause) {
          throw new DataCorruptionError(
            `Corrupt outbox envelope for owner ${ownerId} mutation ${row.mutation_id}`,
            { cause },
          )
        }
      })
    })
  }
}
