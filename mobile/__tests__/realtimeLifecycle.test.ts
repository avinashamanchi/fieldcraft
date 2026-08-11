import type { MutationEnvelope } from '../src/domain/sync'
import { render, screen, waitFor } from '@testing-library/react-native'
import { createElement } from 'react'
import { Text } from 'react-native'
import type {
  PullResult,
  PushResult,
  RealtimeSubscription,
  RemoteGateway,
} from '../src/data/remoteGateway'
import { SyncCoordinator, type SyncClock, type SyncRepository } from '../src/data/syncCoordinator'
import { SyncProvider, useSyncStatus } from '../src/data/SyncProvider'
import { SyncStatusBanner } from '../src/components/SyncStatusBanner'

class LifecycleRepository implements SyncRepository {
  readonly outbox = { list: async (): Promise<MutationEnvelope[]> => [] }
  pulls = 0

  async getSyncCursor(): Promise<string | null> { return null }
  async commitPull(): Promise<void> { this.pulls += 1 }
  async acknowledgeMutation(): Promise<void> {}
  async recordMutationFailure(): Promise<void> {}
  async recordMutationConflict(): Promise<void> {}
  async countConflicts(): Promise<number> { return 0 }
}

class LifecycleGateway implements RemoteGateway {
  readonly subscriptions: { ownerId: string; active: boolean; invalidate: () => void }[] = []
  pulls = 0
  pullGate: Promise<void> | null = null
  activePulls = 0
  maxActivePulls = 0

  async pullSince(_ownerId: string, _cursor: string | null, signal: AbortSignal): Promise<PullResult> {
    this.pulls += 1
    this.activePulls += 1
    this.maxActivePulls = Math.max(this.maxActivePulls, this.activePulls)
    try {
      await (this.pullGate ?? Promise.resolve())
      if (signal.aborted) return { rows: [], cursor: 'aborted', hasMore: false }
      return { rows: [], cursor: `cursor-${this.pulls}`, hasMore: false }
    } finally {
      this.activePulls -= 1
    }
  }

  async pushMutation(): Promise<PushResult> {
    return { type: 'applied', rows: [] }
  }

  subscribeToOwner(ownerId: string, onInvalidation: () => void): RealtimeSubscription {
    const record = { ownerId, active: true, invalidate: onInvalidation }
    this.subscriptions.push(record)
    return { unsubscribe: () => { record.active = false } }
  }
}

const active = { ownerId: 'owner-a', authenticated: true, foreground: true, online: true }

class LifecycleClock implements SyncClock {
  nowMs = Date.parse('2026-08-07T12:00:00.000Z')
  readonly timers = new Map<number, { callback: () => void; delay: number }>()
  private nextId = 1
  now(): number { return this.nowMs }
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++
    this.timers.set(id, { callback, delay })
    return id
  }
  clearTimeout(handle: unknown): void { this.timers.delete(Number(handle)) }
  runNext(): void {
    const next = [...this.timers.entries()].sort((left, right) => left[0] - right[0])[0]
    if (!next) throw new Error('No scheduled timer')
    this.timers.delete(next[0])
    this.nowMs += next[1].delay
    next[1].callback()
  }
}

const setup = () => {
  const repository = new LifecycleRepository()
  const gateway = new LifecycleGateway()
  const clock = new LifecycleClock()
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    clock,
    refreshAuthentication: async () => {},
  })
  return { repository, gateway, coordinator, clock }
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

it('subscribes only for an authenticated foreground online owner', async () => {
  const { coordinator, gateway } = setup()

  await coordinator.setLifecycle({ ...active, authenticated: false })
  await coordinator.setLifecycle({ ...active, authenticated: true, foreground: false })
  await coordinator.setLifecycle({ ...active, foreground: true, online: false })
  expect(gateway.subscriptions).toEqual([])

  await coordinator.setLifecycle(active)
  expect(gateway.subscriptions).toEqual([
    expect.objectContaining({ ownerId: 'owner-a', active: true }),
  ])
})

it('cleans the subscription on background, sign-out, owner change, and dispose', async () => {
  const { coordinator, gateway } = setup()
  await coordinator.setLifecycle(active)
  const foreground = gateway.subscriptions[0]

  await coordinator.setLifecycle({ ...active, foreground: false })
  expect(foreground.active).toBe(false)

  await coordinator.setLifecycle(active)
  const signedIn = gateway.subscriptions[1]
  await coordinator.setLifecycle({ ...active, ownerId: null, authenticated: false })
  expect(signedIn.active).toBe(false)

  await coordinator.setLifecycle(active)
  const ownerA = gateway.subscriptions[2]
  await coordinator.setLifecycle({ ...active, ownerId: 'owner-b' })
  expect(ownerA.active).toBe(false)
  expect(gateway.subscriptions[3]).toMatchObject({ ownerId: 'owner-b', active: true })

  coordinator.dispose()
  expect(gateway.subscriptions[3].active).toBe(false)
})

it('treats Realtime payloads only as coalesced invalidation hints', async () => {
  let releasePull!: () => void
  const { coordinator, gateway, repository, clock } = setup()
  await coordinator.setLifecycle(active)
  const initialPulls = gateway.pulls
  gateway.pullGate = new Promise<void>((resolve) => { releasePull = resolve })

  gateway.subscriptions[0].invalidate()
  gateway.subscriptions[0].invalidate()
  await flushMicrotasks()
  expect(gateway.pulls).toBe(initialPulls)
  expect(clock.timers.size).toBe(1)
  clock.runNext()
  await flushMicrotasks()
  expect(gateway.pulls).toBe(initialPulls + 1)
  expect(gateway.maxActivePulls).toBe(1)
  expect(repository.pulls).toBe(1)

  releasePull()
  await coordinator.whenIdle()
  expect(repository.pulls).toBe(2)
})

it('cancels a pending pull when the app backgrounds and ignores its response', async () => {
  let releasePull!: () => void
  const { coordinator, gateway, repository, clock } = setup()
  await coordinator.setLifecycle(active)
  gateway.pullGate = new Promise<void>((resolve) => { releasePull = resolve })
  gateway.subscriptions[0].invalidate()
  clock.runNext()
  await flushMicrotasks()

  const background = coordinator.setLifecycle({ ...active, foreground: false })
  releasePull()
  await background
  await coordinator.whenIdle()

  expect(repository.pulls).toBe(1)
  expect(gateway.subscriptions[0].active).toBe(false)
})

it('publishes coordinator status through useSyncStatus', async () => {
  const { coordinator } = setup()
  const StatusProbe = () => createElement(
    Text,
    { testID: 'sync-status' },
    JSON.stringify(useSyncStatus()),
  )

  render(createElement(
    SyncProvider,
    {
      coordinator,
      lifecycle: { ownerId: 'owner-a', authenticated: true, foreground: true, online: false },
    },
    createElement(StatusProbe),
  ))

  await waitFor(() => expect(JSON.parse(
    screen.getByTestId('sync-status').props.children as string,
  )).toEqual({ state: 'offline', pending: 0 }))
})

it('renders an accessible conflict status without exposing record content', () => {
  render(createElement(SyncStatusBanner, { status: { state: 'conflict', count: 2 } }))

  expect(screen.getByText('2 conflicts need review')).toBeTruthy()
  expect(screen.getByTestId('sync-status-banner').props.accessibilityLiveRegion).toBe('polite')
})
