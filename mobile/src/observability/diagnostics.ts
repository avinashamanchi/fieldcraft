export type DiagnosticSnapshot = Readonly<{
  version: 1
  ownerPresent: boolean
  syncState: string
  pendingBucket: '0' | '1-49' | '50-199' | '200+'
  quarantinedBucket: '0' | '1-9' | '10+'
  conflictBucket: '0' | '1-9' | '10+'
  lastSyncedAt?: string
}>

const bucket = (value: number, boundaries: readonly [number, string][], overflow: string): string => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_DIAGNOSTIC_COUNT')
  for (const [maximum, label] of boundaries) if (value <= maximum) return label
  return overflow
}

export const buildDiagnosticSnapshot = (input: Readonly<{
  ownerPresent: boolean
  syncState: string
  pendingCount: number
  quarantinedCount: number
  conflictCount: number
  lastSyncedAt?: string
}>): DiagnosticSnapshot => {
  if (!/^[a-z-]{1,30}$/.test(input.syncState)) throw new Error('INVALID_DIAGNOSTIC_STATE')
  if (input.lastSyncedAt !== undefined && !Number.isFinite(Date.parse(input.lastSyncedAt))) throw new Error('INVALID_DIAGNOSTIC_TIME')
  return Object.freeze({
    version: 1,
    ownerPresent: input.ownerPresent,
    syncState: input.syncState,
    pendingBucket: bucket(input.pendingCount, [[0, '0'], [49, '1-49'], [199, '50-199']], '200+') as DiagnosticSnapshot['pendingBucket'],
    quarantinedBucket: bucket(input.quarantinedCount, [[0, '0'], [9, '1-9']], '10+') as DiagnosticSnapshot['quarantinedBucket'],
    conflictBucket: bucket(input.conflictCount, [[0, '0'], [9, '1-9']], '10+') as DiagnosticSnapshot['conflictBucket'],
    ...(input.lastSyncedAt ? { lastSyncedAt: new Date(input.lastSyncedAt).toISOString() } : {}),
  })
}
