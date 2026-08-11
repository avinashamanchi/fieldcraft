import { buildDiagnosticSnapshot } from '../src/observability/diagnostics'
import { redactEvent } from '../src/observability/events'

it('allows only content-free operational fields', () => {
  expect(redactEvent({
    requestId: '70000000-0000-4000-8000-000000000001',
    route: 'sync-pull', status: 'failed', reason: 'timeout', latencyBucket: '<1s',
    email: 'private@example.test', invoice: 'secret invoice', ownerId: 'owner-secret',
  })).toEqual({
    requestId: '70000000-0000-4000-8000-000000000001',
    route: 'sync-pull', status: 'failed', reason: 'timeout', latencyBucket: '<1s',
  })
})

it('builds bounded diagnostics without record content or raw owner identity', () => {
  expect(buildDiagnosticSnapshot({
    ownerPresent: true, syncState: 'failed', pendingCount: 12,
    quarantinedCount: 2, conflictCount: 1, lastSyncedAt: '2026-08-10T12:00:00.000Z',
  })).toEqual({
    version: 1, ownerPresent: true, syncState: 'failed', pendingBucket: '1-49',
    quarantinedBucket: '1-9', conflictBucket: '1-9', lastSyncedAt: '2026-08-10T12:00:00.000Z',
  })
})
