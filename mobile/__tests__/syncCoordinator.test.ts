import type { MutationEnvelope } from '../src/domain/sync'
import type {
  PullResult,
  PushResult,
  RemoteGateway,
  RealtimeSubscription,
} from '../src/data/remoteGateway'
import {
  computeRetryDelayMs,
  RemoteGatewayError,
  SyncCoordinator,
  type SyncClock,
  type SyncRepository,
} from '../src/data/syncCoordinator'
import type { CloudRowEnvelope } from '../src/data/repository'
import { createSupabaseGateway } from '../src/data/supabaseGateway'

const OWNER_A = 'owner-a'
const OWNER_B = 'owner-b'

const clientPayload = (
  ownerId: string,
  id: string,
  name: string,
  version = 1,
  syncState: 'pending' | 'current' | 'conflict' = 'pending',
) => ({
  id,
  ownerId,
  version,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: `2026-08-03T10:00:0${version}.000Z`,
  syncState,
  name,
})

const mutation = (
  id: string,
  entityId: string,
  ownerId = OWNER_A,
): MutationEnvelope => ({
  id,
  ownerId,
  entity: 'client',
  entityId,
  kind: 'create',
  baseVersion: null,
  payload: clientPayload(ownerId, entityId, entityId),
  createdAt: '2026-08-03T10:00:00.000Z',
  attempts: 0,
})

const canonicalRow = (
  ownerId: string,
  entityId: string,
  version = 2,
): CloudRowEnvelope => ({
  ownerId,
  entity: 'client',
  entityId,
  payload: clientPayload(ownerId, entityId, entityId, version, 'current'),
  version,
  updatedAt: `2026-08-03T10:00:0${version}.000Z`,
})

class FakeClock implements SyncClock {
  nowMs = Date.parse('2026-08-03T12:00:00.000Z')
  readonly timers = new Map<number, { callback: () => void; delay: number }>()
  private nextTimer = 1

  now(): number {
    return this.nowMs
  }

  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextTimer++
    this.timers.set(id, { callback, delay })
    return id
  }

  clearTimeout(id: unknown): void {
    this.timers.delete(Number(id))
  }

  runNext(): void {
    const entry = [...this.timers.entries()][0]
    if (!entry) throw new Error('No scheduled timer')
    this.timers.delete(entry[0])
    this.nowMs += entry[1].delay
    entry[1].callback()
  }
}

class FakeRepository implements SyncRepository {
  readonly pending = new Map<string, MutationEnvelope[]>()
  readonly events: string[] = []
  readonly cursors = new Map<string, string | null>()
  conflicts = 0
  failNextAcknowledgement = false
  failFailureRecording = false
  acknowledgementGate: Promise<void> | null = null
  acknowledgementStarted: (() => void) | null = null
  readonly acknowledgementRepairFlags: boolean[] = []

  readonly outbox: {
    list(ownerId: string): Promise<MutationEnvelope[]>
  }

  constructor() {
    this.outbox = {
      list: async (ownerId: string) => [...(this.pending.get(ownerId) ?? [])],
    }
  }

  async getSyncCursor(ownerId: string): Promise<string | null> {
    return this.cursors.get(ownerId) ?? null
  }

  async commitPull(ownerId: string, rows: CloudRowEnvelope[], cursor: string): Promise<void> {
    this.events.push(`pull:${ownerId}:${rows.map((row) => row.entityId).join(',')}`)
    this.cursors.set(ownerId, cursor)
  }

  async acknowledgeMutation(
    ownerId: string,
    mutationId: string,
    rows: CloudRowEnvelope[],
    isCurrent: () => boolean = () => true,
    requiresBootstrapRepair = false,
  ): Promise<void> {
    this.acknowledgementRepairFlags.push(requiresBootstrapRepair)
    this.events.push(`ack-start:${mutationId}:${rows.map((row) => row.entityId).join(',')}`)
    this.acknowledgementStarted?.()
    await (this.acknowledgementGate ?? Promise.resolve())
    if (!isCurrent()) return
    if (this.failNextAcknowledgement) {
      this.failNextAcknowledgement = false
      throw new Error('simulated local transaction failure')
    }
    this.pending.set(
      ownerId,
      (this.pending.get(ownerId) ?? []).filter((item) => item.id !== mutationId),
    )
    this.events.push(`ack-commit:${mutationId}`)
  }

  async recordMutationFailure(
    _ownerId: string,
    mutationId: string,
    reason: 'transient' | 'reauthentication' | 'validation' | 'invalid-response',
  ): Promise<void> {
    if (this.failFailureRecording) throw new Error('simulated durable transition failure')
    this.events.push(`failure:${mutationId}:${reason}`)
  }

  async recordMutationConflict(
    _ownerId: string,
    conflict: Parameters<SyncRepository['recordMutationConflict']>[1],
  ): Promise<void> {
    this.events.push(`conflict:${conflict.mutationId}`)
    this.conflicts += 1
    this.pending.set(
      OWNER_A,
      (this.pending.get(OWNER_A) ?? []).filter((item) => item.id !== conflict.mutationId),
    )
  }

  async countConflicts(): Promise<number> {
    return this.conflicts
  }
}

class FakeGateway implements RemoteGateway {
  readonly pushed: string[] = []
  pulls = 0
  pullResult: PullResult = { rows: [], cursor: 'cursor-empty', hasMore: false }
  pushResult: PushResult | null = null
  pushError: unknown = null
  pullGate: Promise<void> | null = null
  pushGate: Promise<void> | null = null
  activePulls = 0
  maxActivePulls = 0

  async pullSince(_ownerId: string, _cursor: string | null, signal: AbortSignal): Promise<PullResult> {
    this.pulls += 1
    this.activePulls += 1
    this.maxActivePulls = Math.max(this.maxActivePulls, this.activePulls)
    try {
      await (this.pullGate ?? Promise.resolve())
      if (signal.aborted) throw new RemoteGatewayError('transient')
      return this.pullResult
    } finally {
      this.activePulls -= 1
    }
  }

  async pushMutation(
    _ownerId: string,
    item: MutationEnvelope,
    signal: AbortSignal,
  ): Promise<PushResult> {
    this.pushed.push(item.id)
    await (this.pushGate ?? Promise.resolve())
    if (signal.aborted) throw new RemoteGatewayError('transient')
    if (this.pushError) throw this.pushError
    return this.pushResult ?? {
      type: 'applied',
      rows: [canonicalRow(item.ownerId, item.entityId)],
    }
  }

  subscribeToOwner(): RealtimeSubscription {
    return { unsubscribe() {} }
  }
}

const makeCoordinator = (
  repository = new FakeRepository(),
  gateway = new FakeGateway(),
  clock = new FakeClock(),
  refreshAuthentication: (ownerId: string, signal: AbortSignal) => Promise<void> = async () => {},
) => ({
  repository,
  gateway,
  clock,
  coordinator: new SyncCoordinator({
    repository,
    gateway,
    clock,
    random: () => 0,
    refreshAuthentication,
  }),
})

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

it('reports queued work offline without contacting the gateway', async () => {
  const { coordinator, repository, gateway } = makeCoordinator()
  repository.pending.set(OWNER_A, [
    mutation('00000000-0000-4000-8000-000000000001', 'client-1'),
    mutation('00000000-0000-4000-8000-000000000002', 'client-2'),
  ])

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: false })

  expect(coordinator.getStatus()).toEqual({ state: 'offline', pending: 2 })
  expect(gateway.pulls).toBe(0)
  expect(gateway.pushed).toEqual([])
})

it('uploads mutations sequentially in durable dependency and FIFO order', async () => {
  const { coordinator, repository, gateway } = makeCoordinator()
  repository.pending.set(OWNER_A, [
    mutation('00000000-0000-4000-8000-000000000010', 'client-parent'),
    {
      ...mutation('00000000-0000-4000-8000-000000000011', 'job-child'),
      entity: 'job',
      payload: {
        id: 'job-child',
        ownerId: OWNER_A,
        version: 1,
        createdAt: '2026-08-03T10:00:00.000Z',
        updatedAt: '2026-08-03T10:00:01.000Z',
        syncState: 'pending',
        clientId: 'client-parent',
        title: 'Dependent job',
        status: 'Scheduled',
      },
    },
  ])

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(gateway.pushed).toEqual([
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000011',
  ])
  expect(repository.events).toEqual([
    'pull:owner-a:',
    'ack-start:00000000-0000-4000-8000-000000000010:client-parent',
    'ack-commit:00000000-0000-4000-8000-000000000010',
    'ack-start:00000000-0000-4000-8000-000000000011:job-child',
    'ack-commit:00000000-0000-4000-8000-000000000011',
  ])
})

it('passes an explicit staged-feed repair requirement into the atomic acknowledgement', async () => {
  const { coordinator, repository, gateway } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000012', 'legacy-repair')
  repository.pending.set(OWNER_A, [item])
  gateway.pushResult = { type: 'applied', rows: [], requiresBootstrapRepair: true }

  await coordinator.setLifecycle({
    ownerId: OWNER_A,
    authenticated: true,
    foreground: true,
    online: true,
  })

  expect(repository.acknowledgementRepairFlags).toEqual([true])
  expect(repository.pending.get(OWNER_A)).toEqual([])
})

it('coalesces duplicate triggers and permits only one pull in flight', async () => {
  let releasePull!: () => void
  const { coordinator, gateway } = makeCoordinator()
  gateway.pullGate = new Promise<void>((resolve) => {
    releasePull = resolve
  })

  const activation = coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })
  const duplicate = coordinator.trigger()
  await flushMicrotasks()
  expect(gateway.pulls).toBe(1)
  releasePull()
  await Promise.all([activation, duplicate])

  expect(gateway.pulls).toBe(1)
  expect(gateway.maxActivePulls).toBe(1)
})

it('bounds exponential retry with jitter between five seconds and five minutes', () => {
  expect(computeRetryDelayMs(0, 0)).toBe(5_000)
  expect(computeRetryDelayMs(1, 0.5)).toBe(10_000)
  expect(computeRetryDelayMs(20, 1)).toBe(300_000)
})

it('durably records a transient failure and retries the same mutation UUID', async () => {
  const { coordinator, repository, gateway, clock } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000020', 'client-retry')
  repository.pending.set(OWNER_A, [item])
  gateway.pushError = new RemoteGatewayError('transient')

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(repository.events).toContain(`failure:${item.id}:transient`)
  expect(coordinator.getStatus()).toEqual({
    state: 'failed',
    pending: 1,
    retryAt: '2026-08-03T12:00:05.000Z',
  })
  expect([...clock.timers.values()].map((timer) => timer.delay)).toEqual([5_000])

  gateway.pushError = null
  clock.runNext()
  await coordinator.whenIdle()
  expect(gateway.pushed).toEqual([item.id, item.id])
})

it('fails visibly and retains work when durable failure recording is unavailable', async () => {
  const { coordinator, repository, gateway, clock } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000025', 'client-storage-failure')
  repository.pending.set(OWNER_A, [item])
  repository.failFailureRecording = true
  gateway.pushError = new RemoteGatewayError('transient')

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(repository.pending.get(OWNER_A)).toEqual([item])
  expect(coordinator.getStatus()).toMatchObject({ state: 'failed', pending: 1 })
  expect(clock.timers.size).toBe(1)
})

it('pauses queued work when authentication refresh fails', async () => {
  const reauthentication = jest.fn()
  const repository = new FakeRepository()
  const gateway = new FakeGateway()
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    clock: new FakeClock(),
    random: () => 0,
    refreshAuthentication: async () => {
      throw new RemoteGatewayError('reauthentication')
    },
    onReauthenticationRequired: reauthentication,
  })
  repository.pending.set(OWNER_A, [mutation('00000000-0000-4000-8000-000000000030', 'client-auth')])

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(gateway.pushed).toEqual([])
  expect(reauthentication).toHaveBeenCalledWith(OWNER_A)
  expect(coordinator.getStatus()).toMatchObject({ state: 'failed', pending: 1 })
})

it('discards a stale pull completion after the owner changes', async () => {
  let releasePull!: () => void
  const { coordinator, repository, gateway } = makeCoordinator()
  gateway.pullResult = {
    rows: [canonicalRow(OWNER_A, 'stale-client')],
    cursor: 'stale-cursor',
    hasMore: false,
  }
  gateway.pullGate = new Promise<void>((resolve) => {
    releasePull = resolve
  })
  const oldRun = coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })
  await flushMicrotasks()

  const newContext = coordinator.setLifecycle({ ownerId: OWNER_B, authenticated: true, foreground: true, online: false })
  releasePull()
  await Promise.all([oldRun, newContext])

  expect(repository.events).not.toContain('pull:owner-a:stale-client')
  expect(coordinator.getStatus()).toEqual({ state: 'offline', pending: 0 })
})

it('replays idempotently when canonical application fails before acknowledgement', async () => {
  const { coordinator, repository, gateway } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000040', 'client-ack')
  repository.pending.set(OWNER_A, [item])
  repository.failNextAcknowledgement = true

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })
  expect(repository.pending.get(OWNER_A)).toEqual([item])

  await coordinator.trigger()

  expect(gateway.pushed).toEqual([item.id, item.id])
  expect(repository.pending.get(OWNER_A)).toEqual([])
})

it('rolls back a local acknowledgement when app generation changes during its transaction', async () => {
  let releaseAcknowledgement!: () => void
  let acknowledgementStarted!: () => void
  const started = new Promise<void>((resolve) => { acknowledgementStarted = resolve })
  const { coordinator, repository } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000045', 'client-generation')
  repository.pending.set(OWNER_A, [item])
  repository.acknowledgementStarted = acknowledgementStarted
  repository.acknowledgementGate = new Promise<void>((resolve) => {
    releaseAcknowledgement = resolve
  })

  const syncing = coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })
  await started
  const background = coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: false, online: true })
  releaseAcknowledgement()
  await Promise.all([syncing, background])

  expect(repository.pending.get(OWNER_A)).toEqual([item])
  expect(repository.events).not.toContain(`ack-commit:${item.id}`)
})

it('preserves both versions and stops FIFO processing on a version conflict', async () => {
  const { coordinator, repository, gateway } = makeCoordinator()
  const conflicted = mutation('00000000-0000-4000-8000-000000000050', 'client-conflict')
  const dependent = mutation('00000000-0000-4000-8000-000000000051', 'client-after')
  repository.pending.set(OWNER_A, [conflicted, dependent])
  gateway.pushResult = {
    type: 'conflict',
    conflict: {
      mutationId: conflicted.id,
      mutationKind: 'create',
      entity: 'client',
      entityId: 'client-conflict',
      localPayload: conflicted.payload,
      cloudPayload: clientPayload(OWNER_A, 'client-conflict', 'Cloud name', 3, 'current'),
      cloudVersion: 3,
    },
  }

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(gateway.pushed).toEqual([conflicted.id])
  expect(repository.events).toContain(`conflict:${conflicted.id}`)
  expect(coordinator.getStatus()).toEqual({ state: 'conflict', count: 1 })
})

it.each([
  ['validation', 'validation'],
  ['invalid-response', 'invalid-response'],
] as const)('fails closed without a timer for %s responses', async (gatewayReason, durableReason) => {
  const { coordinator, repository, gateway, clock } = makeCoordinator()
  const item = mutation('00000000-0000-4000-8000-000000000060', 'client-invalid')
  repository.pending.set(OWNER_A, [item])
  gateway.pushError = new RemoteGatewayError(gatewayReason)

  await coordinator.setLifecycle({ ownerId: OWNER_A, authenticated: true, foreground: true, online: true })

  expect(repository.events).toContain(`failure:${item.id}:${durableReason}`)
  expect(clock.timers.size).toBe(0)
  expect(repository.pending.get(OWNER_A)).toEqual([item])
})

type ProviderReply = { data: unknown; error: unknown | null; status: number }

class FakeQuery {
  constructor(private readonly reply: ProviderReply) {}
  select(): this { return this }
  eq(): this { return this }
  gte(): this { return this }
  order(): this { return this }
  abortSignal(): this { return this }
  async limit(): Promise<ProviderReply> { return this.reply }
}

class FakeSupabaseClient {
  readonly rpcCalls: { name: string; parameters: Record<string, unknown> }[] = []
  rpcReply: ProviderReply = { data: null, error: null, status: 200 }
  readonly tableReplies = new Map<string, ProviderReply>()

  async rpc(name: string, parameters: Record<string, unknown>): Promise<ProviderReply> {
    this.rpcCalls.push({ name, parameters })
    return this.rpcReply
  }

  from(table: string): FakeQuery {
    return new FakeQuery(
      this.tableReplies.get(table) ?? { data: [], error: null, status: 200 },
    )
  }

  channel() {
    return {
      on() { return this },
      subscribe() { return this },
      unsubscribe() {},
    }
  }
}

const rawClient = (id: string, updatedAt = '2026-08-03T10:00:02.000Z') => ({
  id,
  user_id: OWNER_A,
  name: id,
  version: 2,
  created_at: '2026-08-03T10:00:00.000Z',
  updated_at: updatedAt,
})

it('calls the reviewed RPC boundary with the stable mutation UUID', async () => {
  const client = new FakeSupabaseClient()
  client.rpcReply = {
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: '00000000-0000-4000-8000-000000000080',
      entity: 'client',
      kind: 'create',
      entity_id: 'client-rpc',
      cloud: rawClient('client-rpc'),
      sync_position: {
        updated_at: '2026-08-03T10:00:02.000Z', change_id: 80, source: 'sync_changes',
      },
    },
  }
  const gateway = createSupabaseGateway(client)
  const item = mutation('00000000-0000-4000-8000-000000000080', 'client-rpc')

  await expect(gateway.pushMutation(OWNER_A, item, new AbortController().signal)).resolves.toEqual({
    type: 'applied',
    rows: [{
      ...canonicalRow(OWNER_A, 'client-rpc'), changeId: 80, changeSource: 'sync_changes',
    }],
  })
  expect(client.rpcCalls).toEqual([
    {
      name: 'apply_entity_mutation',
      parameters: {
        p_mutation_id: item.id,
        p_entity: 'client',
        p_kind: 'create',
        p_entity_id: 'client-rpc',
        p_base_version: null,
        p_payload: item.payload,
      },
    },
  ])
})

it('sends the reviewed object payload for deletes and returns a canonical tombstone', async () => {
  const client = new FakeSupabaseClient()
  client.rpcReply = {
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: '00000000-0000-4000-8000-000000000084',
      entity: 'client',
      kind: 'delete',
      entity_id: 'client-delete',
      deleted_version: 4,
      deleted_at: '2026-08-03T10:00:00.000Z',
      sync_position: {
        updated_at: '2026-08-03T10:00:00.000Z', change_id: 84, source: 'sync_changes',
      },
    },
  }
  const gateway = createSupabaseGateway(client)
  const item = {
    ...mutation('00000000-0000-4000-8000-000000000084', 'client-delete'),
    kind: 'delete' as const,
    baseVersion: 4,
    payload: null,
  }

  await expect(gateway.pushMutation(OWNER_A, item, new AbortController().signal)).resolves.toEqual({
    type: 'applied',
    rows: [{
      ownerId: OWNER_A,
      entity: 'client',
      entityId: 'client-delete',
      payload: null,
      version: 4,
      updatedAt: item.createdAt,
      changeId: 84,
      changeSource: 'sync_changes',
      deleted: true,
    }],
  })
  expect(client.rpcCalls[0].parameters.p_payload).toEqual({})
})

it('uses save_invoice_bundle for compound invoice mutations', async () => {
  const client = new FakeSupabaseClient()
  client.rpcReply = { status: 503, error: { message: 'unavailable secret' }, data: null }
  const gateway = createSupabaseGateway(client)
  const item = {
    ...mutation('00000000-0000-4000-8000-000000000081', 'invoice-1'),
    entity: 'invoice' as const,
    kind: 'save_invoice_bundle' as const,
    payload: {
      client: clientPayload(OWNER_A, 'client-1', 'Client'),
      job: {
        id: 'job-1', ownerId: OWNER_A, version: 1,
        createdAt: '2026-08-03T10:00:00.000Z', updatedAt: '2026-08-03T10:00:01.000Z',
        syncState: 'pending', clientId: 'client-1', title: 'Job', status: 'Scheduled',
      },
      invoice: {
        id: 'invoice-1', ownerId: OWNER_A, version: 1,
        createdAt: '2026-08-03T10:00:00.000Z', updatedAt: '2026-08-03T10:00:01.000Z',
        syncState: 'pending', clientId: 'client-1', jobId: 'job-1',
        draft: {
          clientName: 'Client', jobTitle: 'Job', tradeType: 'Plumbing',
          taxBasisPoints: 0, paymentTerms: 'Due on receipt',
          lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
        },
        subtotalCents: 100, taxCents: 0, totalCents: 100,
      },
    },
  }

  await expect(gateway.pushMutation(OWNER_A, item, new AbortController().signal)).rejects.toMatchObject({
    reason: 'transient',
  })
  expect(client.rpcCalls).toEqual([{
    name: 'save_invoice_bundle',
    parameters: {
      p_mutation_id: item.id,
      p_payload: expect.objectContaining({
        client: expect.objectContaining({ id: 'client-1' }),
        job: expect.objectContaining({ id: 'job-1', tradeType: 'Plumbing' }),
        invoice: expect.objectContaining({
          id: 'invoice-1',
          number: 'invoice-1',
          lineItems: item.payload.invoice.draft.lineItems,
        }),
      }),
    },
  }])
})

it.each([
  [0, 'transient'],
  [401, 'reauthentication'],
  [400, 'validation'],
  [409, 'invalid-response'],
  [500, 'transient'],
] as const)('maps provider status %s to %s without retaining provider content', async (status, reason) => {
  const client = new FakeSupabaseClient()
  client.rpcReply = { status, error: { message: 'provider payload must not escape' }, data: null }
  const gateway = createSupabaseGateway(client)

  const result = gateway.pushMutation(
    OWNER_A,
    mutation('00000000-0000-4000-8000-000000000082', 'client-error'),
    new AbortController().signal,
  )

  await expect(result).rejects.toMatchObject({ reason })
  await expect(result).rejects.not.toThrow(/provider payload/i)
})

it('normalizes the reviewed version-conflict response and rejects unknown shapes', async () => {
  const client = new FakeSupabaseClient()
  const item = {
    ...mutation('00000000-0000-4000-8000-000000000083', 'client-conflict'),
    kind: 'update' as const,
    baseVersion: 1,
  }
  client.rpcReply = {
    status: 200,
    error: null,
    data: {
      status: 'conflict',
      mutation_id: item.id,
      entity: 'client',
      entity_id: item.entityId,
      cloud_version: 2,
      cloud_payload: rawClient(item.entityId),
    },
  }
  const gateway = createSupabaseGateway(client)

  await expect(gateway.pushMutation(OWNER_A, item, new AbortController().signal)).resolves.toEqual({
    type: 'conflict',
    conflict: {
      mutationId: item.id,
      ownerId: OWNER_A,
      mutationKind: 'update',
      entity: 'client',
      entityId: item.entityId,
      localPayload: item.payload,
      cloudPayload: canonicalRow(OWNER_A, item.entityId).payload,
      cloudVersion: 2,
    },
  })

  client.rpcReply = {
    ...client.rpcReply,
    status: 409,
    error: { message: 'version conflict' },
  }
  await expect(
    gateway.pushMutation(OWNER_A, item, new AbortController().signal),
  ).resolves.toMatchObject({ type: 'conflict' })

  client.rpcReply = { status: 200, error: null, data: { status: 'mystery' } }
  await expect(
    gateway.pushMutation(OWNER_A, item, new AbortController().signal),
  ).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('pulls owner-readable rows from the globally ordered change feed', async () => {
  const client = new FakeSupabaseClient()
  client.rpcReply = {
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [
        { change_id: 1, owner_id: OWNER_A, entity: 'client', entity_id: 'client-a', version: 2, updated_at: '2026-08-03T10:00:02.000Z', deleted: false, payload: rawClient('client-a', '2026-08-03T10:00:02.000Z') },
        { change_id: 2, owner_id: OWNER_A, entity: 'client', entity_id: 'client-b', version: 2, updated_at: '2026-08-03T10:00:02.000Z', deleted: false, payload: rawClient('client-b', '2026-08-03T10:00:02.000Z') },
        { change_id: 3, owner_id: OWNER_A, entity: 'client', entity_id: 'client-z', version: 2, updated_at: '2026-08-03T10:00:03.000Z', deleted: false, payload: rawClient('client-z', '2026-08-03T10:00:03.000Z') },
      ],
      cursor: { updated_at: '2026-08-03T10:00:03.000Z', change_id: 3 },
      has_more: false,
    },
  }
  const gateway = createSupabaseGateway(client)

  const result = await gateway.pullSince(OWNER_A, null, new AbortController().signal)

  expect(result.rows.map((row) => row.entityId)).toEqual(['client-a', 'client-b', 'client-z'])
  expect(JSON.parse(result.cursor)).toEqual({
    updatedAt: '2026-08-03T10:00:03.000Z',
    changeId: 3,
  })
  expect(result.hasMore).toBe(false)
})

it('normalizes a changed invoice from its bounded owner-readable relation projection', async () => {
  const client = new FakeSupabaseClient()
  const invoice = {
    id: 'invoice-pull',
    user_id: OWNER_A,
    client_id: 'client-old',
    job_id: 'job-old',
    number: 'INV-1',
    line_items: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
    subtotal_cents: 100,
    tax_basis_points: 0,
    tax_cents: 0,
    total_cents: 100,
    payment_terms: 'Due on receipt',
    version: 2,
    created_at: '2026-08-03T10:00:00.000Z',
    updated_at: '2026-08-03T10:00:04.000Z',
    clients: { name: 'Older client' },
    jobs: { title: 'Older job', trade_type: 'Plumbing' },
  }
  client.rpcReply = {
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [{
        change_id: 4,
        owner_id: OWNER_A,
        entity: 'invoice',
        entity_id: 'invoice-pull',
        version: 2,
        updated_at: '2026-08-03T10:00:04.000Z',
        deleted: false,
        payload: invoice,
      }],
      cursor: { updated_at: '2026-08-03T10:00:04.000Z', change_id: 4 },
      has_more: false,
    },
  }
  const gateway = createSupabaseGateway(client)

  const result = await gateway.pullSince(OWNER_A, null, new AbortController().signal)

  expect(result.rows).toEqual([
    expect.objectContaining({
      entity: 'invoice',
      entityId: 'invoice-pull',
      payload: expect.objectContaining({
        draft: expect.objectContaining({
          clientName: 'Older client',
          jobTitle: 'Older job',
          tradeType: 'Plumbing',
        }),
      }),
    }),
  ])
})
