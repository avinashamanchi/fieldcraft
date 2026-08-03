import type { ConflictRecord, EntityName, MutationEnvelope } from '../domain/sync'

export type CloudRowEnvelope = {
  ownerId: string
  entity: EntityName
  entityId: string
  payload: unknown
  version: number
  updatedAt: string
  deleted?: boolean
}

export interface FieldCraftRepository {
  initialize(ownerId: string): Promise<void>
  list<T>(entity: EntityName): Promise<T[]>
  get<T>(entity: EntityName, id: string): Promise<T | null>
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
  applyCloudRows(rows: CloudRowEnvelope[]): Promise<void>
  markConflict(conflict: ConflictRecord): Promise<void>
  clearOwner(ownerId: string): Promise<void>
  close(): Promise<void>
}

export class DataCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataCorruptionError'
  }
}
