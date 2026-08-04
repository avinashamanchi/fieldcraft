import type { ConflictRecord, EntityName, MutationEnvelope } from '../domain/sync'
import type { Client, Invoice, Job } from '../domain/entities'

export type InvoiceBundlePayload = {
  client: Client
  job: Job
  invoice: Invoice
}

export type InvoiceBundleCloudPayload = {
  client: Client | null
  job: Job | null
  invoice: Invoice | null
}

export type CloudRowEnvelope = {
  ownerId: string
  entity: EntityName
  entityId: string
  payload: unknown
  version: number
  updatedAt: string
  deleted?: boolean
}

export type MutationFailureReason =
  | 'transient'
  | 'reauthentication'
  | 'validation'
  | 'invalid-response'

export interface FieldCraftRepository {
  initialize(ownerId: string): Promise<void>
  list<T>(entity: EntityName): Promise<T[]>
  get<T>(entity: EntityName, id: string): Promise<T | null>
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
  subscribeToLocalMutations(listener: (ownerId: string) => void): () => void
  applyCloudRows(rows: CloudRowEnvelope[]): Promise<void>
  markConflict(conflict: ConflictRecord): Promise<void>
  getSyncCursor(ownerId: string): Promise<string | null>
  commitPull(
    ownerId: string,
    rows: CloudRowEnvelope[],
    cursor: string,
    markInitialHydration?: boolean,
    isCurrent?: () => boolean,
  ): Promise<void>
  hasCompletedInitialPull(ownerId: string): Promise<boolean>
  waitForInitialPull(ownerId: string): Promise<void>
  acknowledgeMutation(
    ownerId: string,
    mutationId: string,
    rows: CloudRowEnvelope[],
    isCurrent?: () => boolean,
  ): Promise<void>
  recordMutationFailure(
    ownerId: string,
    mutationId: string,
    reason: MutationFailureReason,
    isCurrent?: () => boolean,
  ): Promise<void>
  recordMutationConflict(
    ownerId: string,
    conflict: ConflictRecord,
    isCurrent?: () => boolean,
  ): Promise<void>
  countConflicts(ownerId: string): Promise<number>
  getConflict(mutationId: string): Promise<ConflictRecord | null>
  resolveConflictKeepCloud(mutationId: string): Promise<void>
  resolveConflictWithMutation(
    originalMutationId: string,
    replacement: MutationEnvelope,
  ): Promise<void>
  clearOwner(ownerId: string): Promise<void>
  close(): Promise<void>
}

export class DataCorruptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataCorruptionError'
  }
}
