import type { EntityName } from '../domain/sync'

export const ACCOUNT_EXPORT_ENTITIES: readonly EntityName[] = [
  'profile', 'client', 'job', 'invoice', 'estimate', 'payment',
  'reminder_schedule', 'expense', 'service', 'inventory',
]

export type ExportManifestV1 = Readonly<{
  schemaVersion: 1
  ownerId: string
  createdAt: string
  files: readonly Readonly<{
    name: string
    rows: number
    sha256: string
    bytes: number
  }>[]
}>

export type ExportRecord = Readonly<{
  entity: EntityName
  data: Record<string, unknown>
}>
