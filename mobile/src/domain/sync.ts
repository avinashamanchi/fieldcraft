export type EntityName =
  | 'profile'
  | 'client'
  | 'job'
  | 'invoice'
  | 'estimate'
  | 'payment'
  | 'reminder_schedule'
  | 'expense'
  | 'service'
  | 'inventory'
export type MutationKind =
  | 'create'
  | 'update'
  | 'delete'
  | 'save_invoice_bundle'
  | 'save_estimate'
  | 'convert_estimate'
  | 'issue_invoice'
  | 'record_manual_payment'

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
  failureReason?: 'transient' | 'reauthentication' | 'validation' | 'invalid-response'
}

export type ConflictRecord = {
  mutationId: string
  ownerId?: string
  mutationKind?: MutationKind
  entity: EntityName
  entityId: string
  localPayload: unknown
  cloudPayload: unknown
  cloudVersion: number
  cloudRows: import('../data/repository').CloudRowEnvelope[]
}
