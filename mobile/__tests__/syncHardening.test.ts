import type { MutationEnvelope } from '../src/domain/sync'
import type { PullResult, PushResult, RealtimeSubscription, RemoteGateway } from '../src/data/remoteGateway'
import {
  RemoteGatewayError,
  SyncCoordinator,
  type SyncClock,
  type SyncRepository,
} from '../src/data/syncCoordinator'
import type { CloudRowEnvelope } from '../src/data/repository'

const OWNER_A = 'owner-a'
const OWNER_B = 'owner-b'

const mutation = (
  id: string,
  failureReason?: MutationEnvelope['failureReason'],
): MutationEnvelope => ({
  id,
  ownerId: OWNER_A,
  entity: 'client',
  entityId: `client-${id.at(-1)}`,
  kind: 'create',
  baseVersion: null,
  payload: {
    id: `client-${id.at(-1)}`,
    ownerId: OWNER_A,
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending',
    name: 'Offline client',
  },
  createdAt: '2026-08-03T10:00:00.000Z',
  attempts: 0,
  ...(failureReason ? { failureReason } : {}),
})

class FakeClock implements SyncClock {
  nowMs = Date.parse('2026-08-03T12:00:00.000Z')
  private nextId = 1
  readonly timers = new Map<number, { callback: () => void; delay: number }>()

  now(): number { return this.nowMs }
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++
    this.timers.set(id, { callback, delay })
    return id
  }
  clearTimeout(handle: unknown): void { this.timers.delete(Number(handle)) }
  runNext(): void {
    const entry = [...this.timers.entries()][0]
    if (!entry) throw new Error('No timer is scheduled')
    this.timers.delete(entry[0])
    this.nowMs += entry[1].delay
    entry[1].callback()
  }
}

class Repository implements SyncRepository {
  pending: MutationEnvelope[] = []
  commits: { cursor: string; markInitialHydration: boolean }[] = []
  readonly outbox = { list: async () => [...this.pending] }

  async getSyncCursor(): Promise<string | null> { return null }
  async commitPull(
    _ownerId: string,
    _rows: CloudRowEnvelope[],
    cursor: string,
    markInitialHydration: boolean,
  ): Promise<void> {
    this.commits.push({ cursor, markInitialHydration })
  }
  async acknowledgeMutation(_ownerId: string, mutationId: string): Promise<void> {
    this.pending = this.pending.filter((item) => item.id !== mutationId)
  }
  async recordMutationFailure(): Promise<void> {}
  async recordMutationConflict(): Promise<void> {}
  async countConflicts(): Promise<number> { return 0 }
}

class Gateway implements RemoteGateway {
  pulls: string[] = []
  pushed: string[] = []
  pullResults: PullResult[] = [{ rows: [], cursor: 'cursor-1', hasMore: false }]
  pullErrors: unknown[] = []
  readonly subscriptions: {
    ownerId: string
    active: boolean
    invalidate(): void
    fail(): void
  }[] = []
  gates = new Map<string, Promise<void>>()

  async pullSince(ownerId: string, _cursor: string | null, signal: AbortSignal): Promise<PullResult> {
    this.pulls.push(ownerId)
    await (this.gates.get(ownerId) ?? Promise.resolve())
    if (signal.aborted) throw new RemoteGatewayError('transient')
    const error = this.pullErrors.shift()
    if (error) throw error
    return this.pullResults.shift() ?? { rows: [], cursor: 'cursor-final', hasMore: false }
  }
  async pushMutation(
    _ownerId: string,
    item: MutationEnvelope,
  ): Promise<PushResult> {
    this.pushed.push(item.id)
    return { type: 'applied', rows: [] }
  }
  subscribeToOwner(
    ownerId: string,
    onInvalidation: () => void,
    onFailure: () => void,
  ): RealtimeSubscription {
    const record = {
      ownerId,
      active: true,
      invalidate: () => { if (record.active) onInvalidation() },
      fail: () => { if (record.active) onFailure() },
    }
    this.subscriptions.push(record)
    return { unsubscribe: () => { record.active = false } }
  }
}

const active = (ownerId = OWNER_A) => ({
  ownerId,
  authenticated: true,
  foreground: true,
  online: true,
})

const flush = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

const setup = (random: () => number = () => 0) => {
  const repository = new Repository()
  const gateway = new Gateway()
  const clock = new FakeClock()
  const onReauthenticationRequired = jest.fn()
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    clock,
    random,
    refreshAuthentication: async () => {},
    onReauthenticationRequired,
  })
  return { repository, gateway, clock, coordinator, onReauthenticationRequired }
}

it('retains an active-run mutation hint and immediately performs one coalesced follow-up', async () => {
  let release!: () => void
  const { repository, gateway, coordinator } = setup()
  gateway.gates.set(OWNER_A, new Promise<void>((resolve) => { release = resolve }))

  const initial = coordinator.setLifecycle(active())
  await flush()
  repository.pending = [mutation('00000000-0000-4000-8000-000000000001')]
  const hinted = coordinator.notifyLocalMutation()
  coordinator.notifyLocalMutation()
  await flush()

  expect(coordinator.getStatus()).toEqual({ state: 'syncing', pending: 1 })
  release()
  await Promise.all([initial, hinted])
  await coordinator.whenIdle()

  expect(gateway.pulls).toEqual([OWNER_A, OWNER_A])
  expect(gateway.pushed).toEqual(['00000000-0000-4000-8000-000000000001'])
  expect(coordinator.getStatus().state).toBe('current')
})

it('leaves a permanent FIFO head visible and never uploads a later dependent mutation', async () => {
  const { repository, gateway, coordinator } = setup()
  repository.pending = [
    mutation('00000000-0000-4000-8000-000000000001', 'validation'),
    mutation('00000000-0000-4000-8000-000000000002'),
  ]

  await coordinator.setLifecycle(active())

  expect(gateway.pushed).toEqual([])
  expect(coordinator.getStatus()).toMatchObject({ state: 'failed', pending: 2 })
})

it('updates the durable pending count after an offline local mutation without contacting cloud', async () => {
  const { repository, gateway, coordinator } = setup()
  await coordinator.setLifecycle({ ...active(), online: false })
  repository.pending = [mutation('00000000-0000-4000-8000-000000000003')]

  await coordinator.notifyLocalMutation()

  expect(coordinator.getStatus()).toEqual({ state: 'offline', pending: 1 })
  expect(gateway.pulls).toEqual([])
})

it('commits every pull page but marks first hydration only on the terminal page', async () => {
  const { repository, gateway, coordinator } = setup()
  gateway.pullResults = [
    { rows: [], cursor: 'cursor-500', hasMore: true },
    { rows: [], cursor: 'cursor-750', hasMore: false },
  ]

  await coordinator.setLifecycle(active())
  await coordinator.whenIdle()

  expect(repository.commits).toEqual([
    { cursor: 'cursor-500', markInitialHydration: false },
    { cursor: 'cursor-750', markInitialHydration: true },
  ])
})

it('starts a new owner generation even when the stale owner RPC never settles', async () => {
  const { gateway, coordinator } = setup()
  gateway.gates.set(OWNER_A, new Promise<void>(() => {}))

  void coordinator.setLifecycle(active(OWNER_A))
  await flush()
  const ownerB = coordinator.setLifecycle(active(OWNER_B))
  await flush()

  expect(gateway.pulls).toEqual([OWNER_A, OWNER_B])
  await ownerB
  expect(coordinator.getStatus().state).toBe('current')
  coordinator.dispose()
})

it('requests reauthentication for a pull-side 401', async () => {
  const { gateway, coordinator, onReauthenticationRequired } = setup()
  gateway.pullErrors = [new RemoteGatewayError('reauthentication')]

  await coordinator.setLifecycle(active())

  expect(onReauthenticationRequired).toHaveBeenCalledWith(OWNER_A)
  expect(coordinator.getStatus().state).toBe('failed')
})

it('tracks pull retry attempts independently and resets after a successful pull', async () => {
  const { gateway, clock, coordinator } = setup(() => 0.5)
  gateway.pullErrors = [
    new RemoteGatewayError('transient'),
    new RemoteGatewayError('transient'),
  ]

  await coordinator.setLifecycle(active())
  expect([...clock.timers.values()][0]?.delay).toBe(5_000)
  expect((coordinator as unknown as { retryAttempts: { pull: number } }).retryAttempts.pull).toBe(1)
  clock.runNext()
  await coordinator.whenIdle()
  expect((coordinator as unknown as { retryAttempts: { pull: number } }).retryAttempts.pull).toBe(2)
  expect([...clock.timers.values()][0]?.delay).toBe(10_000)
  clock.runNext()
  await coordinator.whenIdle()
  expect(coordinator.getStatus().state).toBe('current')

  gateway.pullErrors = [new RemoteGatewayError('transient')]
  await coordinator.trigger()
  expect([...clock.timers.values()][0]?.delay).toBe(5_000)
})

it('retains realtime invalidations, resubscribes, and backs off repeated channel failures', async () => {
  let release!: () => void
  const { gateway, clock, coordinator } = setup(() => 0.5)
  gateway.gates.set(OWNER_A, new Promise<void>((resolve) => { release = resolve }))
  const initial = coordinator.setLifecycle(active())
  await flush()

  gateway.subscriptions[0].invalidate()
  gateway.subscriptions[0].fail()
  expect(gateway.subscriptions[0].active).toBe(false)
  expect(clock.timers.size).toBe(1)
  release()
  await initial
  await coordinator.whenIdle()

  clock.runNext()
  await flush()
  expect(gateway.subscriptions).toHaveLength(2)
  expect(gateway.pulls.length).toBeGreaterThanOrEqual(2)

  gateway.subscriptions[1].fail()
  expect([...clock.timers.values()][0]?.delay).toBe(10_000)
})
