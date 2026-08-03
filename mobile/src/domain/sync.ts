export type EntityName =
  | 'profile'
  | 'client'
  | 'job'
  | 'invoice'
  | 'expense'
  | 'service'
  | 'inventory'
export type MutationKind = 'create' | 'update' | 'delete' | 'save_invoice_bundle'

export type MutationEnvelope = {
  id: string
  ownerId: string
  entity: EntityName
  entityId: string
  kind: MutationKind
  baseVersion: number | null
  payload: unknown
  createdAt: string
  attempts: number
}

export type ConflictRecord = {
  mutationId: string
  entity: EntityName
  entityId: string
  localPayload: unknown
  cloudPayload: unknown
  cloudVersion: number
}
