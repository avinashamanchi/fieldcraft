import { getSupabaseClient } from '../auth/supabase'

export type DeleteSubsystem =
  | 'repository' | 'outbox' | 'quarantine' | 'conflicts' | 'auth'
  | 'entitlement' | 'stripe-links' | 'reminders' | 'consent' | 'artifacts' | 'memory'
export type DeleteOutcome = { ok: true } | { ok: false; failed: DeleteSubsystem[] }

export type DeleteLocalDataDependencies = {
  clearVisibleMemory(): void
  clearRepository(): Promise<void>
  clearOutbox(): Promise<void>
  clearQuarantine(): Promise<void>
  clearConflicts(): Promise<void>
  clearAuth(): Promise<void>
  clearEntitlement(): Promise<void>
  clearStripeLinks(): Promise<void>
  clearReminders(): Promise<void>
  clearConsent(): Promise<void>
  clearArtifacts(): Promise<void>
  setRetryMarker(ownerId: string, failed: DeleteSubsystem[]): Promise<void>
  clearRetryMarker(ownerId: string): Promise<void>
}

const ORDER: DeleteSubsystem[] = [
  'repository', 'outbox', 'quarantine', 'conflicts', 'auth', 'entitlement',
  'stripe-links', 'reminders', 'consent', 'artifacts', 'memory',
]

export const clearLocalAuthentication = async (): Promise<void> => {
  const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' })
  if (error) throw new Error('Local authentication storage could not be cleared.')
}

export const deleteLocalData = async (ownerId: string, dependencies: DeleteLocalDataDependencies): Promise<DeleteOutcome> => {
  if (!ownerId) return { ok: false, failed: ['memory'] }
  const failed = new Set<DeleteSubsystem>()
  try { dependencies.clearVisibleMemory() } catch { failed.add('memory') }
  try { await dependencies.setRetryMarker(ownerId, ORDER) } catch { failed.add('memory') }
  const operations: [DeleteSubsystem, () => Promise<void>][] = [
    ['repository', dependencies.clearRepository],
    ['outbox', dependencies.clearOutbox],
    ['quarantine', dependencies.clearQuarantine],
    ['conflicts', dependencies.clearConflicts],
    ['auth', dependencies.clearAuth],
    ['entitlement', dependencies.clearEntitlement],
    ['stripe-links', dependencies.clearStripeLinks],
    ['reminders', dependencies.clearReminders],
    ['consent', dependencies.clearConsent],
    ['artifacts', dependencies.clearArtifacts],
  ]
  const results = await Promise.allSettled(operations.map(([, operation]) => operation()))
  results.forEach((result, index) => { if (result.status === 'rejected') failed.add(operations[index][0]) })
  if (failed.size === 0) {
    try { await dependencies.clearRetryMarker(ownerId) } catch { failed.add('memory') }
  }
  if (failed.size > 0) {
    const ordered = ORDER.filter((subsystem) => failed.has(subsystem))
    try { await dependencies.setRetryMarker(ownerId, ordered) } catch {
      failed.add('memory')
      return { ok: false, failed: ORDER.filter((subsystem) => failed.has(subsystem)) }
    }
    return { ok: false, failed: ordered }
  }
  return { ok: true }
}
