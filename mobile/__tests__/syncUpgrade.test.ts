jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
  randomUUID: () => '00000000-0000-4000-8000-000000000099',
}))

import { __getRawDatabase, __resetSQLiteMock, openDatabaseAsync } from 'expo-sqlite'

import type { MutationEnvelope } from '../src/domain/sync'
import { canonicalStringify, hashMutationEnvelope } from '../src/data/outbox'
import type { CloudRowEnvelope, InvoiceBundlePayload } from '../src/data/repository'
import { RemoteGatewayError, type PullResult, type PushResult, type RemoteGateway } from '../src/data/remoteGateway'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import { createSupabaseGateway, type SupabaseGatewayClient } from '../src/data/supabaseGateway'
import { SyncCoordinator, type SyncClock } from '../src/data/syncCoordinator'

const OWNER = 'owner-a'
const DATABASE = 'legacy-feed-upgrade.db'
const SHARED_TIME = '2026-08-03T10:00:10.000Z'

type PositionedCloudRow = CloudRowEnvelope & { changeSeq: number; changeId: number }

const localClient = (overrides: Record<string, unknown> = {}) => ({
  id: 'client-local',
  ownerId: OWNER,
  version: 7,
  createdAt: '2026-08-03T09:00:00.000Z',
  updatedAt: '2026-08-03T09:07:00.000Z',
  syncState: 'pending',
  name: 'Unsynced local edit',
  ...overrides,
})

const rawClient = (id: string, name: string, version: number, updatedAt = SHARED_TIME) => ({
  id,
  user_id: OWNER,
  name,
  version,
  created_at: '2026-08-03T09:00:00.000Z',
  updated_at: updatedAt,
})

const feedReply = (
  changeId: number,
  id: string,
  name: string,
  hasMore: boolean,
) => ({
  status: 200,
  error: null,
  data: {
    status: 'ok',
    changes: [{
      change_seq: changeId,
      change_id: changeId,
      owner_id: OWNER,
      entity: 'client',
      entity_id: id,
      version: 2,
      payload: rawClient(id, name, 2),
      deleted: false,
      updated_at: SHARED_TIME,
    }],
    cursor: { updated_at: SHARED_TIME, change_seq: changeId, change_id: changeId },
    has_more: hasMore,
  },
})

class Client implements SupabaseGatewayClient {
  readonly calls: { name: string; parameters: Record<string, unknown> }[] = []
  replies: { status: number; error: null; data: unknown }[] = []

  rpc(name: string, parameters: Record<string, unknown>) {
    this.calls.push({ name, parameters })
    return Promise.resolve(this.replies.shift() ?? { status: 200, error: null, data: null })
  }

  channel() {
    return {
      on() { return this },
      subscribe() { return this },
      unsubscribe() {},
    }
  }
}

class ScriptedGateway implements RemoteGateway {
  readonly pushed: string[] = []
  pulls: PullResult[] = []
  pushes: PushResult[] = []
  pushErrors: Error[] = []

  async pullSince(): Promise<PullResult> {
    const result = this.pulls.shift()
    if (!result) throw new Error('Missing scripted pull result')
    return result
  }

  async pushMutation(_ownerId: string, mutation: MutationEnvelope): Promise<PushResult> {
    this.pushed.push(mutation.id)
    const error = this.pushErrors.shift()
    if (error) throw error
    const result = this.pushes.shift()
    if (!result) throw new Error('Missing scripted push result')
    return result
  }

  subscribeToOwner() {
    return { unsubscribe() {} }
  }
}

const active = {
  ownerId: OWNER,
  authenticated: true,
  foreground: true,
  online: true,
}

const initializeLegacyRepository = async (databaseName: string) => {
  await openDatabaseAsync(databaseName)
  const raw = __getRawDatabase(databaseName)
  raw.userVersion = 1
  raw.tables = new Set(['records', 'outbox', 'conflicts', 'sync_cursors', 'metadata'])
  raw.syncCursors.push({
    owner_id: OWNER,
    entity: '__all__',
    cursor: JSON.stringify({ updatedAt: '2026-08-03T09:00:00.000Z', id: 'legacy' }),
  })
  raw.metadata.push({ owner_id: OWNER, key: 'initial-cloud-pull-complete', value: 'true' })
  const repository = new SQLiteFieldCraftRepository({ databaseName })
  await repository.initialize(OWNER)
  return { raw, repository }
}

const clientEnvelope = (
  id: string,
  name: string,
  version: number,
  updatedAt: string,
  changeId = 1,
): PositionedCloudRow => ({
  ownerId: OWNER,
  entity: 'client',
  entityId: id,
  payload: {
    id,
    ownerId: OWNER,
    version,
    createdAt: '2026-08-03T09:00:00.000Z',
    updatedAt,
    syncState: 'current',
    name,
  },
  version,
  updatedAt,
  changeSource: 'sync_changes',
  changeSeq: changeId,
  changeId,
})

const tombstone = (
  entity: CloudRowEnvelope['entity'],
  entityId: string,
  version: number,
  updatedAt: string,
  changeId = 1,
): PositionedCloudRow => ({
  ownerId: OWNER,
  entity,
  entityId,
  payload: null,
  version,
  updatedAt,
  changeSource: 'sync_changes',
  changeSeq: changeId,
  changeId,
  deleted: true,
})

const pendingClientMutation = (
  id: string,
  entityId: string,
  name: string,
  version = 1,
): MutationEnvelope => ({
  id,
  ownerId: OWNER,
  entity: 'client',
  entityId,
  kind: version === 0 ? 'create' : 'update',
  baseVersion: version === 0 ? null : version,
  payload: {
    id: entityId,
    ownerId: OWNER,
    version,
    createdAt: '2026-08-03T09:00:00.000Z',
    updatedAt: '2026-08-03T09:01:00.000Z',
    syncState: 'pending',
    name,
  },
  createdAt: '2026-08-03T09:01:00.000Z',
  attempts: 0,
})

const bundlePayload = (
  version: number,
  updatedAt: string,
  syncState: 'pending' | 'current',
  label: string,
): InvoiceBundlePayload => ({
  client: {
    id: 'bundle-client', ownerId: OWNER, version,
    createdAt: '2026-08-03T09:00:00.000Z', updatedAt, syncState,
    name: `${label} client`,
  },
  job: {
    id: 'bundle-job', ownerId: OWNER, version,
    createdAt: '2026-08-03T09:00:00.000Z', updatedAt, syncState,
    clientId: 'bundle-client', title: `${label} job`, status: 'Invoiced',
  },
  invoice: {
    id: 'bundle-invoice', ownerId: OWNER, version,
    createdAt: '2026-08-03T09:00:00.000Z', updatedAt, syncState,
    clientId: 'bundle-client', jobId: 'bundle-job',
    draft: {
      clientName: `${label} client`, jobTitle: `${label} job`, tradeType: 'General',
      taxBasisPoints: 0, paymentTerms: 'Due on receipt',
      lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
    },
    subtotalCents: 100, taxCents: 0, totalCents: 100,
  },
})

const pendingBundleMutation = (id: string): MutationEnvelope => ({
  id,
  ownerId: OWNER,
  entity: 'invoice',
  entityId: 'bundle-invoice',
  kind: 'save_invoice_bundle',
  baseVersion: 1,
  payload: bundlePayload(1, '2026-08-03T09:01:00.000Z', 'pending', 'Local'),
  createdAt: '2026-08-03T09:01:00.000Z',
  attempts: 0,
})

const bundleRows = (
  bundle: InvoiceBundlePayload,
  changeIds: readonly [number, number, number] = [1, 2, 3],
): PositionedCloudRow[] => (
  (['client', 'job', 'invoice'] as const).map((entity, index) => ({
    ownerId: OWNER,
    entity,
    entityId: bundle[entity].id,
    payload: bundle[entity],
    version: bundle[entity].version,
    updatedAt: bundle[entity].updatedAt,
    changeSource: 'sync_changes',
    changeSeq: changeIds[index],
    changeId: changeIds[index],
  }))
)

const runCoordinator = async (repository: SQLiteFieldCraftRepository, gateway: RemoteGateway) => {
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    refreshAuthentication: async () => {},
  })
  await coordinator.setLifecycle(active)
  await coordinator.whenIdle()
  return coordinator
}

beforeEach(() => __resetSQLiteMock())

it('forces a hydrated v3 owner through fresh authority reconciliation before accepting an old receipt', async () => {
  const databaseName = 'v3-authority-upgrade.db'
  await openDatabaseAsync(databaseName)
  const raw = __getRawDatabase(databaseName)
  raw.userVersion = 3
  raw.tables = new Set([
    'records', 'outbox', 'conflicts', 'sync_cursors', 'metadata', 'sync_bootstrap_records',
  ])
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000080',
    'v3-client',
    'Old local edit',
    2,
  )
  raw.records.push({
    owner_id: OWNER,
    entity: 'client',
    entity_id: mutation.entityId,
    payload_json: canonicalStringify(clientEnvelope(
      mutation.entityId,
      'Newer cloud state',
      5,
      '2026-08-03T10:00:05.000Z',
      100,
    ).payload),
    version: 5,
    deleted: 0,
    updated_at: '2026-08-03T10:00:05.000Z',
  })
  raw.outbox.push({
    owner_id: OWNER,
    mutation_id: mutation.id,
    sequence: 1,
    entity: mutation.entity,
    entity_id: mutation.entityId,
    kind: mutation.kind,
    base_version: mutation.baseVersion,
    payload_json: canonicalStringify(mutation.payload),
    payload_hash: await hashMutationEnvelope(mutation),
    created_at: mutation.createdAt,
    attempts: 0,
    state: 'pending',
    last_error: null,
  })
  const retainedCursor = JSON.stringify({
    updatedAt: '2026-08-03T10:00:05.000Z', changeSeq: 100, changeId: 100,
  })
  raw.syncCursors.push({ owner_id: OWNER, entity: '__all__', cursor: retainedCursor })
  raw.metadata.push({ owner_id: OWNER, key: 'initial-cloud-pull-complete', value: 'true' })

  const repository = new SQLiteFieldCraftRepository({ databaseName })
  await repository.initialize(OWNER)

  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  expect(raw.metadata).toContainEqual({
    owner_id: OWNER, key: 'sync-feed-v2-reconciliation-required', value: 'true',
  })

  const newer = clientEnvelope(
    mutation.entityId,
    'Newer cloud state',
    5,
    '2026-08-03T10:00:05.000Z',
    100,
  )
  const oldReceipt = clientEnvelope(
    mutation.entityId,
    'Old applied receipt',
    3,
    '2026-08-03T10:00:03.000Z',
    90,
  )
  const seenCursors: Array<string | null> = []
  const gateway: RemoteGateway = {
    async pullSince(_ownerId, cursor) {
      seenCursors.push(cursor)
      return cursor === null
        ? { rows: [newer], cursor: retainedCursor, hasMore: false }
        : { rows: [], cursor: retainedCursor, hasMore: false }
    },
    async pushMutation() {
      return { type: 'applied', rows: [oldReceipt] }
    },
    subscribeToOwner() { return { unsubscribe() {} } },
  }

  await runCoordinator(repository, gateway)

  expect(seenCursors).toEqual([null])
  await expect(repository.get('client', mutation.entityId)).resolves.toMatchObject({
    name: 'Newer cloud state', version: 5, syncState: 'current',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
})

it('requeues immutable v3 conflict intents whose authority rows cannot be reconstructed', async () => {
  const databaseName = 'v3-conflict-upgrade.db'
  await openDatabaseAsync(databaseName)
  const raw = __getRawDatabase(databaseName)
  raw.userVersion = 3
  raw.tables = new Set([
    'records', 'outbox', 'conflicts', 'sync_cursors', 'metadata', 'sync_bootstrap_records',
  ])
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000079',
    'legacy-conflict-client',
    'Preserved local conflict',
    2,
  )
  const payloadJson = canonicalStringify(mutation.payload)
  const payloadHash = await hashMutationEnvelope(mutation)
  raw.outbox.push({
    owner_id: OWNER,
    mutation_id: mutation.id,
    sequence: 7,
    entity: mutation.entity,
    entity_id: mutation.entityId,
    kind: mutation.kind,
    base_version: mutation.baseVersion,
    payload_json: payloadJson,
    payload_hash: payloadHash,
    created_at: mutation.createdAt,
    attempts: 2,
    state: 'conflict',
    last_error: null,
  })
  raw.conflicts.push({
    owner_id: OWNER,
    mutation_id: mutation.id,
    entity: mutation.entity,
    entity_id: mutation.entityId,
    local_payload_json: payloadJson,
    cloud_payload_json: canonicalStringify(clientEnvelope(
      mutation.entityId, 'Legacy cloud conflict', 3, SHARED_TIME,
    ).payload),
    cloud_version: 3,
  })
  raw.metadata.push({ owner_id: OWNER, key: 'initial-cloud-pull-complete', value: 'true' })

  const repository = new SQLiteFieldCraftRepository({ databaseName })
  await repository.initialize(OWNER)

  await expect(repository.countConflicts(OWNER)).resolves.toBe(0)
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({
      id: mutation.id,
      payload: mutation.payload,
      attempts: 2,
    }),
  ])
  expect(raw.outbox[0]).toMatchObject({
    mutation_id: mutation.id,
    payload_json: payloadJson,
    payload_hash: payloadHash,
    state: 'pending',
    last_error: null,
  })
  expect(raw.conflicts).toEqual([])
  expect(raw.metadata).toContainEqual({
    owner_id: OWNER, key: 'sync-feed-v2-reconciliation-required', value: 'true',
  })
})

it('attributes terminal-bootstrap bundle corruption to the exact intent and schedules no retry', async () => {
  const { raw, repository } = await initializeLegacyRepository('bootstrap-exact-corruption.db')
  const pending = pendingBundleMutation('00000000-0000-4000-8000-000000000078')
  await repository.transactLocalMutation(pending)
  const delays: number[] = []
  const clock: SyncClock = {
    now: () => Date.parse('2026-08-03T12:00:00.000Z'),
    setTimeout: (_callback, delayMs) => {
      delays.push(delayMs)
      return delays.length
    },
    clearTimeout: () => {},
  }
  let pushed = false
  const gateway: RemoteGateway = {
    async pullSince() {
      const stored = raw.outbox.find((row) => row.mutation_id === pending.id)!
      stored.payload_json = '{}'
      return {
        rows: [],
        cursor: JSON.stringify({
          updatedAt: '1970-01-01T00:00:00.000Z', changeSeq: 0, changeId: 0,
        }),
        hasMore: false,
      }
    },
    async pushMutation() {
      pushed = true
      throw new Error('push must not start after terminal bootstrap corruption')
    },
    subscribeToOwner() { return { unsubscribe() {} } },
  }
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    clock,
    refreshAuthentication: async () => {},
  })

  await coordinator.setLifecycle(active)
  await coordinator.whenIdle()

  expect(pushed).toBe(false)
  expect(delays).toEqual([])
  expect(coordinator.getStatus()).toMatchObject({ state: 'failed', pending: 1 })
  expect(raw.outbox.find((row) => row.mutation_id === pending.id)).toMatchObject({
    state: 'failed',
    last_error: 'invalid-response',
  })
  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
})

it('upgrades a packaged legacy cursor through crash-resumable staged reconciliation without losing local work', async () => {
  await openDatabaseAsync(DATABASE)
  const raw = __getRawDatabase(DATABASE)
  raw.userVersion = 1
  raw.tables = new Set(['records', 'outbox', 'conflicts', 'sync_cursors', 'metadata'])
  const pending: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000081',
    ownerId: OWNER,
    entity: 'client',
    entityId: 'client-local',
    kind: 'update',
    baseVersion: 7,
    payload: localClient(),
    createdAt: '2026-08-03T09:07:00.000Z',
    attempts: 0,
  }
  raw.records.push(
    {
      owner_id: OWNER,
      entity: 'client',
      entity_id: 'client-stale',
      payload_json: canonicalStringify(localClient({
        id: 'client-stale', name: 'Deleted before feed creation', syncState: 'current',
      })),
      version: 3,
      deleted: 0,
      updated_at: '2026-08-03T09:03:00.000Z',
    },
    {
      owner_id: OWNER,
      entity: 'client',
      entity_id: 'client-local',
      payload_json: canonicalStringify(pending.payload),
      version: 7,
      deleted: 0,
      updated_at: pending.createdAt,
    },
  )
  raw.outbox.push({
    owner_id: OWNER,
    mutation_id: pending.id,
    sequence: 1,
    entity: pending.entity,
    entity_id: pending.entityId,
    kind: pending.kind,
    base_version: pending.baseVersion,
    payload_json: canonicalStringify(pending.payload),
    payload_hash: await hashMutationEnvelope(pending),
    created_at: pending.createdAt,
    attempts: 0,
    state: 'pending',
    last_error: null,
  })
  raw.syncCursors.push({
    owner_id: OWNER,
    entity: '__all__',
    cursor: JSON.stringify({ updatedAt: '2026-08-03T09:00:00.000Z', id: 'client-old' }),
  })
  raw.metadata.push({ owner_id: OWNER, key: 'initial-cloud-pull-complete', value: 'true' })

  const repository = new SQLiteFieldCraftRepository({ databaseName: DATABASE })
  await repository.initialize(OWNER)
  expect(raw.userVersion).toBe(6)
  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)

  const client = new Client()
  client.replies = [feedReply(1, 'client-server-a', 'Server A', true)]
  const gateway = createSupabaseGateway(client)
  const pageOne = await gateway.pullSince(OWNER, null, new AbortController().signal)
  await repository.commitPull(OWNER, pageOne.rows, pageOne.cursor, false)

  await expect(repository.get('client', 'client-server-a')).resolves.toBeNull()
  await expect(repository.get('client', 'client-stale')).resolves.not.toBeNull()
  await expect(repository.get('client', 'client-local')).resolves.toMatchObject({
    name: 'Unsynced local edit', syncState: 'pending',
  })
  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(pageOne.cursor)

  client.replies = [feedReply(2, 'client-server-b', 'Server B', false)]
  const terminal = await gateway.pullSince(OWNER, pageOne.cursor, new AbortController().signal)
  await expect(repository.commitPull(
    OWNER,
    terminal.rows,
    terminal.cursor,
    true,
    () => false,
  )).rejects.toThrow(/owner changed/i)

  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(pageOne.cursor)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  await expect(repository.get('client', 'client-server-a')).resolves.toBeNull()
  await expect(repository.get('client', 'client-server-b')).resolves.toBeNull()

  client.replies = [
    feedReply(2, 'client-server-b', 'Server B', false),
    {
      status: 200,
      error: null,
      data: {
        status: 'applied',
        mutation_id: pending.id,
        entity: 'client',
        entity_id: 'client-local',
        kind: 'update',
        cloud: rawClient('client-local', 'Unsynced local edit', 8, '2026-08-03T10:00:11.000Z'),
        sync_position: {
          updated_at: '2026-08-03T10:00:11.000Z', change_seq: 3, change_id: 3, source: 'sync_changes',
        },
      },
    },
  ]
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    refreshAuthentication: async () => {},
  })
  await coordinator.setLifecycle({
    ownerId: OWNER,
    authenticated: true,
    foreground: true,
    online: true,
  })
  await coordinator.whenIdle()

  expect(coordinator.getStatus().state).toBe('current')
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  await expect(repository.get('client', 'client-stale')).resolves.toBeNull()
  await expect(repository.get('client', 'client-server-a')).resolves.toMatchObject({ name: 'Server A' })
  await expect(repository.get('client', 'client-server-b')).resolves.toMatchObject({ name: 'Server B' })
  await expect(repository.get('client', 'client-local')).resolves.toMatchObject({
    name: 'Unsynced local edit', version: 8, syncState: 'current',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  expect((raw as unknown as { bootstrapRecords: unknown[] }).bootstrapRecords).toEqual([])
  expect(client.calls.filter((call) => call.name === 'pull_sync_changes')).toEqual([
    expect.objectContaining({ parameters: { p_cursor_change_seq: null, p_limit: 200 } }),
    expect.objectContaining({ parameters: { p_cursor_change_seq: 1, p_limit: 200 } }),
    expect.objectContaining({ parameters: { p_cursor_change_seq: 1, p_limit: 200 } }),
  ])
})

it('keeps a newer multipage bootstrap update authoritative after replaying an older applied receipt', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-old-generic-receipt.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000082',
    'receipt-client',
    'Local edit before crash',
  )
  await repository.transactLocalMutation(mutation)

  const applied = clientEnvelope('receipt-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z', 100)
  const newer = clientEnvelope('receipt-client', 'Newer remote edit', 3, '2026-08-03T10:00:02.000Z', 101)
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    { rows: [applied], cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeSeq":100,"changeId":100}', hasMore: true },
    { rows: [newer], cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":101,"changeId":101}', hasMore: false },
  ]
  gateway.pushes = [{ type: 'applied', rows: [applied] }]

  const coordinator = await runCoordinator(repository, gateway)

  await expect(repository.get('client', 'receipt-client')).resolves.toMatchObject({
    name: 'Newer remote edit', version: 3, syncState: 'current',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":101,"changeId":101}',
  )
  expect(coordinator.getStatus().state).toBe('current')
  expect(gateway.pushed).toEqual([mutation.id])
})

it('keeps a later bootstrap tombstone authoritative instead of resurrecting an old receipt row', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-old-generic-delete.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000083',
    'deleted-receipt-client',
    'Local edit before crash',
  )
  await repository.transactLocalMutation(mutation)

  const applied = clientEnvelope('deleted-receipt-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z', 200)
  const deleted = tombstone('client', 'deleted-receipt-client', 2, '2026-08-03T10:00:03.000Z', 201)
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    { rows: [applied], cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeSeq":200,"changeId":200}', hasMore: true },
    { rows: [deleted], cursor: '{"updatedAt":"2026-08-03T10:00:03.000Z","changeSeq":201,"changeId":201}', hasMore: false },
  ]
  gateway.pushes = [{ type: 'applied', rows: [applied] }]

  const coordinator = await runCoordinator(repository, gateway)

  await expect(repository.get('client', 'deleted-receipt-client')).resolves.toBeNull()
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  expect(coordinator.getStatus().state).toBe('current')
})

it('reapplies later authoritative bundle member edits and tombstones after an old bundle receipt', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-old-bundle-receipt.db')
  const mutation = pendingBundleMutation('00000000-0000-4000-8000-000000000084')
  await repository.transactLocalMutation(mutation)

  const appliedBundle = bundlePayload(2, '2026-08-03T10:00:01.000Z', 'current', 'Applied')
  const newerClient = clientEnvelope('bundle-client', 'Newer remote client', 3, '2026-08-03T10:00:04.000Z', 301)
  const deletedJob = tombstone('job', 'bundle-job', 2, '2026-08-03T10:00:05.000Z', 302)
  const deletedInvoice = tombstone('invoice', 'bundle-invoice', 2, '2026-08-03T10:00:06.000Z', 303)
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    {
      rows: bundleRows(appliedBundle, [298, 299, 300]),
      cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeSeq":300,"changeId":300}',
      hasMore: true,
    },
    {
      rows: [newerClient, deletedJob, deletedInvoice],
      cursor: '{"updatedAt":"2026-08-03T10:00:06.000Z","changeSeq":303,"changeId":303}',
      hasMore: false,
    },
  ]
  gateway.pushes = [{ type: 'applied', rows: bundleRows(appliedBundle, [298, 299, 300]) }]

  const coordinator = await runCoordinator(repository, gateway)

  await expect(repository.get('client', 'bundle-client')).resolves.toMatchObject({
    name: 'Newer remote client', version: 3,
  })
  await expect(repository.get('job', 'bundle-job')).resolves.toBeNull()
  await expect(repository.get('invoice', 'bundle-invoice')).resolves.toBeNull()
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  expect(coordinator.getStatus().state).toBe('current')
})

it('preserves and sends genuinely unsent generic and bundle work exactly once after bootstrap', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-unsent-work.db')
  const generic = pendingClientMutation(
    '00000000-0000-4000-8000-000000000085',
    'unsent-client',
    'Unsent client',
  )
  const bundle = pendingBundleMutation('00000000-0000-4000-8000-000000000086')
  await repository.transactLocalMutation(generic)
  await repository.transactLocalMutation(bundle)

  const serverGeneric = clientEnvelope(
    'unsent-client',
    'Preexisting server client',
    1,
    '2026-08-03T10:00:01.000Z',
    400,
  )
  const serverBundle = bundlePayload(1, '2026-08-03T10:00:02.000Z', 'current', 'Preexisting server')
  const genericApplied = clientEnvelope(
    'unsent-client',
    'Unsent client',
    2,
    '2026-08-03T10:00:10.000Z',
    404,
  )
  const bundleApplied = bundlePayload(2, '2026-08-03T10:00:11.000Z', 'current', 'Local')
  const gateway = new ScriptedGateway()
  gateway.pulls = [{
    rows: [serverGeneric, ...bundleRows(serverBundle, [401, 402, 403])],
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":403,"changeId":403}',
    hasMore: false,
  }]
  gateway.pushes = [
    { type: 'applied', rows: [genericApplied] },
    { type: 'applied', rows: bundleRows(bundleApplied, [405, 406, 407]) },
  ]

  const coordinator = await runCoordinator(repository, gateway)

  await expect(repository.get('client', 'unsent-client')).resolves.toMatchObject({ version: 2, name: 'Unsent client' })
  await expect(repository.get('invoice', 'bundle-invoice')).resolves.toMatchObject({ version: 2 })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  expect(coordinator.getStatus().state).toBe('current')
  expect(gateway.pushed).toEqual([generic.id, bundle.id])
})

it('keeps terminal repair state durable across a crash before receipt replay and completes it on retry', async () => {
  const databaseName = 'bootstrap-terminal-crash.db'
  const { raw, repository } = await initializeLegacyRepository(databaseName)
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000087',
    'crash-client',
    'Local edit before crash',
  )
  await repository.transactLocalMutation(mutation)
  const applied = clientEnvelope('crash-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z', 500)
  const newer = clientEnvelope('crash-client', 'Newer after receipt', 3, '2026-08-03T10:00:02.000Z', 501)

  await repository.commitPull(
    OWNER,
    [applied, newer],
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":501,"changeId":501}',
    true,
  )

  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  expect(raw.bootstrapRecords).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_id: 'crash-client', version: 3 }),
  ]))
  await repository.close()

  const resumed = new SQLiteFieldCraftRepository({ databaseName })
  await resumed.initialize(OWNER)
  const gateway = new ScriptedGateway()
  gateway.pulls = [{
    rows: [],
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":501,"changeId":501}',
    hasMore: false,
  }]
  gateway.pushes = [{ type: 'applied', rows: [applied] }]

  const coordinator = await runCoordinator(resumed, gateway)

  await expect(resumed.get('client', 'crash-client')).resolves.toMatchObject({
    name: 'Newer after receipt', version: 3,
  })
  await expect(resumed.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  expect(coordinator.getStatus().state).toBe('current')
})

it('rolls back receipt repair when the generation changes and never cross-applies staged owner data', async () => {
  const { raw, repository } = await initializeLegacyRepository('bootstrap-generation-switch.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000088',
    'generation-client',
    'Local edit before switch',
  )
  await repository.transactLocalMutation(mutation)
  const applied = clientEnvelope('generation-client', 'Old receipt', 2, '2026-08-03T10:00:01.000Z', 600)
  const newer = clientEnvelope('generation-client', 'Newer staged row', 3, '2026-08-03T10:00:02.000Z', 601)
  await repository.commitPull(
    OWNER,
    [newer],
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":601,"changeId":601}',
    true,
  )

  await expect(repository.acknowledgeMutation(OWNER, mutation.id, [applied], () => false))
    .rejects.toThrow(/owner changed/i)

  await expect(repository.get('client', 'generation-client')).resolves.toMatchObject({
    name: 'Local edit before switch', syncState: 'pending',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toHaveLength(1)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  expect(raw.bootstrapRecords).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_id: 'generation-client', version: 3 }),
  ]))
})

it('preserves a conflict through bootstrap and applies staged authority when keep-cloud resolves it', async () => {
  const { raw, repository } = await initializeLegacyRepository('bootstrap-conflict-resolution.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000089',
    'conflict-client',
    'Local conflict edit',
  )
  await repository.transactLocalMutation(mutation)
  const conflictCloud = clientEnvelope(
    'conflict-client',
    'Conflict response row',
    5,
    '2026-08-03T10:00:00.000100Z',
    700,
  )
  const newer = clientEnvelope(
    'conflict-client',
    'Later staged recreation',
    1,
    '2026-08-03T10:00:00.000900Z',
    701,
  )
  await repository.commitPull(
    OWNER,
    [newer],
    '{"updatedAt":"2026-08-03T10:00:00.000900Z","changeSeq":701,"changeId":701}',
    true,
  )
  await repository.recordMutationConflict(OWNER, {
    mutationId: mutation.id,
    ownerId: OWNER,
    mutationKind: 'update',
    entity: 'client',
    entityId: 'conflict-client',
    localPayload: mutation.payload,
    cloudPayload: conflictCloud.payload,
    cloudVersion: 5,
    cloudRows: [conflictCloud],
  })

  await repository.resolveConflictKeepCloud(mutation.id)

  await expect(repository.get('client', 'conflict-client')).resolves.toMatchObject({
    name: 'Later staged recreation', version: 1,
  })
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  await expect(repository.countConflicts(OWNER)).resolves.toBe(0)
  expect(raw.bootstrapRecords).toEqual([])
})

it('fails a malformed legacy replay closed while keeping its staged repair durable', async () => {
  const { raw, repository } = await initializeLegacyRepository('bootstrap-malformed-receipt.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000090',
    'malformed-receipt-client',
    'Local edit awaiting replay',
  )
  await repository.transactLocalMutation(mutation)
  const newer = clientEnvelope(
    'malformed-receipt-client',
    'Staged repair must survive',
    3,
    '2026-08-03T10:00:02.000Z',
  )
  const gateway = new ScriptedGateway()
  gateway.pulls = [{
    rows: [newer],
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeSeq":801,"changeId":801}',
    hasMore: false,
  }]
  gateway.pushErrors = [new RemoteGatewayError('validation')]

  const coordinator = await runCoordinator(repository, gateway)

  expect(coordinator.getStatus()).toMatchObject({ state: 'failed', pending: 1 })
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: mutation.id, failureReason: 'validation' }),
  ])
  expect(raw.bootstrapRecords).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_id: 'malformed-receipt-client', version: 3 }),
  ]))
})

it('uses change_id to keep a same-time recreation newer than an older delete receipt', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-equal-time-delete-then-recreate.db')
  const mutation: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000101',
    ownerId: OWNER,
    entity: 'client',
    entityId: 'equal-time-client',
    kind: 'delete',
    baseVersion: 4,
    payload: null,
    createdAt: SHARED_TIME,
    attempts: 0,
  }
  await repository.transactLocalMutation(mutation)
  const receiptDelete = tombstone('client', 'equal-time-client', 4, SHARED_TIME, 900)
  const stagedRecreation = clientEnvelope(
    'equal-time-client',
    'Recreated after delete',
    1,
    SHARED_TIME,
    901,
  )

  await repository.commitPull(
    OWNER,
    [receiptDelete],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 900, changeId: 900 }),
    false,
  )
  await repository.commitPull(
    OWNER,
    [stagedRecreation],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 901, changeId: 901 }),
    true,
  )
  await repository.acknowledgeMutation(OWNER, mutation.id, [receiptDelete])

  await expect(repository.get('client', 'equal-time-client')).resolves.toMatchObject({
    name: 'Recreated after delete',
    version: 1,
  })
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('uses committed sequence instead of PostgreSQL microseconds when authority positions disagree', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-microsecond-stage-order.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000120',
    'microsecond-stage-client',
    'Local edit',
  )
  await repository.transactLocalMutation(mutation)
  const receipt = clientEnvelope(
    mutation.entityId,
    'Earlier receipt',
    2,
    '2026-08-03T10:00:00.000100Z',
    2000,
  )
  const staged = clientEnvelope(
    mutation.entityId,
    'Later staged authority',
    3,
    '2026-08-03T10:00:00.000900Z',
    1000,
  )
  await repository.commitPull(
    OWNER,
    [staged],
    JSON.stringify({ updatedAt: staged.updatedAt, changeSeq: staged.changeSeq, changeId: staged.changeId }),
    true,
  )

  await repository.acknowledgeMutation(OWNER, mutation.id, [receipt])

  await expect(repository.get('client', mutation.entityId)).resolves.toMatchObject({
    name: 'Earlier receipt',
    version: 2,
  })
})

it('keeps authoritative bootstrap absence over a pre-feed generic receipt', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-absent-generic.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000117',
    'absent-generic-client',
    'Applied before feed creation',
  )
  await repository.transactLocalMutation(mutation)
  await repository.commitPull(
    OWNER,
    [],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 1000, changeId: 1000 }),
    true,
  )
  const legacyReceipt: CloudRowEnvelope = {
    ...clientEnvelope(
      mutation.entityId,
      'Old applied receipt',
      2,
      '2026-08-03T10:00:01.000Z',
      0,
    ),
    changeSource: 'legacy_receipt',
  }

  await repository.acknowledgeMutation(OWNER, mutation.id, [legacyReceipt])

  await expect(repository.get('client', mutation.entityId)).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('keeps authoritative bootstrap absence over every pre-feed bundle receipt member', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-absent-bundle.db')
  const mutation = pendingBundleMutation('00000000-0000-4000-8000-000000000118')
  await repository.transactLocalMutation(mutation)
  await repository.commitPull(
    OWNER,
    [],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 1010, changeId: 1010 }),
    true,
  )
  const legacyRows = bundleRows(
    bundlePayload(2, '2026-08-03T10:00:01.000Z', 'current', 'Old applied'),
    [0, 0, 0],
  ).map((row) => ({ ...row, changeSource: 'legacy_receipt' as const }))

  await repository.acknowledgeMutation(OWNER, mutation.id, legacyRows)

  await expect(repository.get('client', 'bundle-client')).resolves.toBeNull()
  await expect(repository.get('job', 'bundle-job')).resolves.toBeNull()
  await expect(repository.get('invoice', 'bundle-invoice')).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('keeps a new post-bootstrap receipt whose feed position is beyond the terminal cursor', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-absent-new-receipt.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000119',
    'new-after-bootstrap-client',
    'Created after bootstrap',
    0,
  )
  await repository.transactLocalMutation(mutation)
  await repository.commitPull(
    OWNER,
    [],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 1020, changeId: 1020 }),
    true,
  )
  const newReceipt: CloudRowEnvelope = {
    ...clientEnvelope(
      mutation.entityId,
      'New canonical create',
      1,
      '2026-08-03T10:00:11.000Z',
      1021,
    ),
    changeSource: 'sync_changes',
  }

  await repository.acknowledgeMutation(OWNER, mutation.id, [newReceipt])

  await expect(repository.get('client', mutation.entityId)).resolves.toMatchObject({
    name: 'New canonical create',
    version: 1,
  })
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('keeps a higher terminal sequence authoritative over a later-timestamp receipt', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-microsecond-post-terminal.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000121',
    'microsecond-post-terminal-client',
    'Created after bootstrap',
    0,
  )
  await repository.transactLocalMutation(mutation)
  const terminalCursor = {
    updatedAt: '2026-08-03T10:00:00.000100Z',
    changeSeq: 2000,
    changeId: 2000,
  }
  await repository.commitPull(OWNER, [], JSON.stringify(terminalCursor), true)
  const receipt: CloudRowEnvelope = {
    ...clientEnvelope(
      mutation.entityId,
      'Later microsecond receipt',
      1,
      '2026-08-03T10:00:00.000900Z',
      1000,
    ),
    changeSource: 'sync_changes',
  }

  await repository.acknowledgeMutation(OWNER, mutation.id, [receipt])

  await expect(repository.get('client', mutation.entityId)).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it.each([
  ['legacy receipt with a positive change ID', 'legacy_receipt', 7],
  ['sync change with the reserved zero change ID', 'sync_changes', 0],
] as const)('rejects a repository receipt invariant violation: %s', async (
  _label,
  changeSource,
  changeId,
) => {
  const databaseName = `receipt-source-invariant-${changeSource}.db`
  const repository = new SQLiteFieldCraftRepository({ databaseName })
  await repository.initialize(OWNER)
  const mutation = pendingClientMutation(
    changeSource === 'legacy_receipt'
      ? '00000000-0000-4000-8000-000000000122'
      : '00000000-0000-4000-8000-000000000123',
    `receipt-source-${changeSource}`,
    'Pending local edit',
  )
  await repository.transactLocalMutation(mutation)
  const malformed: CloudRowEnvelope = {
    ...clientEnvelope(
      mutation.entityId,
      'Malformed receipt',
      2,
      '2026-08-03T10:00:01.000Z',
      changeId,
    ),
    changeSource,
  }

  await expect(repository.acknowledgeMutation(OWNER, mutation.id, [malformed]))
    .rejects.toThrow()
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: mutation.id }),
  ])
})

it('uses change_id to keep a receipt recreation newer than a same-time staged delete', async () => {
  const { repository } = await initializeLegacyRepository('bootstrap-equal-time-staged-delete.db')
  const mutation = pendingClientMutation(
    '00000000-0000-4000-8000-000000000102',
    'equal-time-inverse-client',
    'Local edit',
  )
  await repository.transactLocalMutation(mutation)
  const stagedDelete = tombstone('client', 'equal-time-inverse-client', 8, SHARED_TIME, 910)
  const receiptRecreation = clientEnvelope(
    'equal-time-inverse-client',
    'Receipt recreation',
    1,
    SHARED_TIME,
    911,
  )

  await repository.commitPull(
    OWNER,
    [stagedDelete],
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 910, changeId: 910 }),
    true,
  )
  await repository.acknowledgeMutation(OWNER, mutation.id, [receiptRecreation])

  await expect(repository.get('client', 'equal-time-inverse-client')).resolves.toMatchObject({
    name: 'Receipt recreation',
    version: 1,
  })
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('orders every same-time bundle member by its own change_id after a crash restart', async () => {
  const databaseName = 'bootstrap-equal-time-bundle.db'
  const { repository } = await initializeLegacyRepository(databaseName)
  const mutation = pendingBundleMutation('00000000-0000-4000-8000-000000000103')
  await repository.transactLocalMutation(mutation)
  const oldReceipt = bundlePayload(5, SHARED_TIME, 'current', 'Old receipt')
  const laterRecreation = bundlePayload(1, SHARED_TIME, 'current', 'Later recreation')

  await repository.commitPull(
    OWNER,
    bundleRows(oldReceipt, [920, 922, 924]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 924, changeId: 924 }),
    false,
  )
  await repository.commitPull(
    OWNER,
    bundleRows(laterRecreation, [921, 923, 925]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 925, changeId: 925 }),
    true,
  )
  await repository.close()

  const resumed = new SQLiteFieldCraftRepository({ databaseName })
  await resumed.initialize(OWNER)
  await resumed.acknowledgeMutation(
    OWNER,
    mutation.id,
    bundleRows(oldReceipt, [920, 922, 924]),
  )

  await expect(resumed.get('client', 'bundle-client')).resolves.toMatchObject({
    name: 'Later recreation client', version: 1,
  })
  await expect(resumed.get('job', 'bundle-job')).resolves.toMatchObject({
    title: 'Later recreation job', version: 1,
  })
  await expect(resumed.get('invoice', 'bundle-invoice')).resolves.toMatchObject({
    version: 1,
    draft: expect.objectContaining({ clientName: 'Later recreation client' }),
  })
  await expect(resumed.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it.each([
  ['pending', null],
  ['transient', 'transient'],
  ['permanent', 'validation'],
  ['conflict', 'conflict'],
] as const)('reapplies a later same-key %s intent after acknowledging an older mutation', async (
  label,
  disposition,
) => {
  const { repository } = await initializeLegacyRepository(`ack-later-${label}.db`)
  const first = pendingClientMutation(
    '00000000-0000-4000-8000-000000000104',
    `same-key-${label}`,
    'First local edit',
  )
  const second = {
    ...pendingClientMutation(
      '00000000-0000-4000-8000-000000000105',
      `same-key-${label}`,
      'Second exact local edit',
    ),
    createdAt: '2026-08-03T09:02:00.000Z',
    payload: {
      ...(pendingClientMutation(
        '00000000-0000-4000-8000-000000000105',
        `same-key-${label}`,
        'Second exact local edit',
      ).payload as Record<string, unknown>),
      updatedAt: '2026-08-03T09:02:00.000Z',
    },
  }
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)
  if (disposition === 'transient' || disposition === 'validation') {
    await repository.recordMutationFailure(OWNER, second.id, disposition)
  } else if (disposition === 'conflict') {
    const cloud = clientEnvelope(
      second.entityId,
      'Conflicting cloud row',
      4,
      '2026-08-03T10:00:04.000Z',
      940,
    )
    await repository.recordMutationConflict(OWNER, {
      mutationId: second.id,
      ownerId: OWNER,
      mutationKind: 'update',
      entity: 'client',
      entityId: second.entityId,
      localPayload: second.payload,
      cloudPayload: cloud.payload,
      cloudVersion: cloud.version,
      cloudRows: [cloud],
    })
  }

  const firstCanonical = clientEnvelope(
    first.entityId,
    'First canonical receipt',
    2,
    SHARED_TIME,
    941,
  )
  await repository.applyCloudRows([firstCanonical])
  await repository.acknowledgeMutation(OWNER, first.id, [firstCanonical])

  await expect(repository.get('client', second.entityId)).resolves.toEqual(second.payload)
  if (disposition === 'conflict') {
    await expect(repository.getConflict(second.id)).resolves.toMatchObject({
      mutationId: second.id,
      localPayload: second.payload,
    })
  }
})

it('lets the later same-key canonical receipt win after its protected local intent succeeds', async () => {
  const { repository } = await initializeLegacyRepository('ack-later-canonical-wins.db')
  const first = pendingClientMutation(
    '00000000-0000-4000-8000-000000000106',
    'same-key-success',
    'First local edit',
  )
  const second = pendingClientMutation(
    '00000000-0000-4000-8000-000000000107',
    'same-key-success',
    'Second local edit',
  )
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)

  await repository.acknowledgeMutation(OWNER, first.id, [
    clientEnvelope(first.entityId, 'First canonical receipt', 2, SHARED_TIME, 950),
  ])
  await repository.acknowledgeMutation(OWNER, second.id, [
    clientEnvelope(second.entityId, 'Second canonical receipt', 3, SHARED_TIME, 951),
  ])

  await expect(repository.get('client', second.entityId)).resolves.toMatchObject({
    name: 'Second canonical receipt',
    version: 3,
    syncState: 'current',
  })
})

it('reapplies a later overlapping bundle after an older bundle acknowledgement', async () => {
  const { repository } = await initializeLegacyRepository('ack-overlapping-bundles.db')
  const first = pendingBundleMutation('00000000-0000-4000-8000-000000000108')
  const second: MutationEnvelope = {
    ...pendingBundleMutation('00000000-0000-4000-8000-000000000109'),
    payload: bundlePayload(2, '2026-08-03T09:02:00.000Z', 'pending', 'Second local'),
    createdAt: '2026-08-03T09:02:00.000Z',
  }
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)

  const firstCanonical = bundleRows(
    bundlePayload(2, SHARED_TIME, 'current', 'First canonical'),
    [960, 961, 962],
  )
  await repository.applyCloudRows(firstCanonical)
  await repository.acknowledgeMutation(OWNER, first.id, firstCanonical)

  await expect(repository.get('client', 'bundle-client')).resolves.toEqual(
    (second.payload as InvoiceBundlePayload).client,
  )
  await expect(repository.get('job', 'bundle-job')).resolves.toEqual(
    (second.payload as InvoiceBundlePayload).job,
  )
  await expect(repository.get('invoice', 'bundle-invoice')).resolves.toEqual(
    (second.payload as InvoiceBundlePayload).invoice,
  )
})

it('rolls back receipt, staging repair, and later-intent reapply when the generation changes', async () => {
  const { raw, repository } = await initializeLegacyRepository('ack-later-generation-rollback.db')
  const first = pendingClientMutation(
    '00000000-0000-4000-8000-000000000110',
    'generation-same-key',
    'First local edit',
  )
  const second = pendingClientMutation(
    '00000000-0000-4000-8000-000000000111',
    'generation-same-key',
    'Second local edit',
  )
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)
  const staged = clientEnvelope(
    second.entityId,
    'Staged authority',
    5,
    '2026-08-03T10:00:05.000Z',
    970,
  )
  await repository.commitPull(
    OWNER,
    [staged],
    JSON.stringify({ updatedAt: staged.updatedAt, changeSeq: staged.changeSeq, changeId: staged.changeId }),
    true,
  )

  await expect(repository.acknowledgeMutation(
    OWNER,
    first.id,
    [clientEnvelope(first.entityId, 'First canonical', 2, SHARED_TIME, 969)],
    () => false,
  )).rejects.toThrow(/owner changed/i)

  await expect(repository.get('client', second.entityId)).resolves.toEqual(second.payload)
  expect(raw.outbox.filter((row) => row.state !== 'complete')).toHaveLength(2)
  expect(raw.bootstrapRecords).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity_id: second.entityId, version: 5 }),
  ]))
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
})

it('uses a completed staged bootstrap to repair an unreconstructable legacy invoice receipt', async () => {
  const { repository } = await initializeLegacyRepository('legacy-invoice-feed-repair.db')
  const local = bundlePayload(1, '2026-08-03T09:01:00.000Z', 'pending', 'Legacy local')
  const mutation: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000112',
    ownerId: OWNER,
    entity: 'invoice',
    entityId: local.invoice.id,
    kind: 'update',
    baseVersion: 1,
    payload: local.invoice,
    createdAt: local.invoice.updatedAt,
    attempts: 0,
  }
  await repository.transactLocalMutation(mutation)
  const staged = bundlePayload(4, SHARED_TIME, 'current', 'Staged server')
  await repository.commitPull(
    OWNER,
    bundleRows(staged, [980, 981, 982]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 982, changeId: 982 }),
    true,
  )

  await repository.acknowledgeMutation(OWNER, mutation.id, [], () => true, true)

  await expect(repository.get('invoice', staged.invoice.id)).resolves.toEqual(staged.invoice)
  await expect(repository.get('client', staged.client.id)).resolves.toEqual(staged.client)
  await expect(repository.get('job', staged.job.id)).resolves.toEqual(staged.job)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('schedules and completes a fresh bootstrap for a hydrated owner needing legacy repair', async () => {
  const databaseName = 'legacy-invoice-repair-no-stage.db'
  const repository = new SQLiteFieldCraftRepository({ databaseName })
  await repository.initialize(OWNER)
  const hydratedCursor = JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 970, changeId: 970 })
  await repository.commitPull(OWNER, [], hydratedCursor, true)
  const raw = __getRawDatabase(databaseName)
  const local = bundlePayload(1, '2026-08-03T09:01:00.000Z', 'pending', 'Legacy local')
  const mutation: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000113',
    ownerId: OWNER,
    entity: 'invoice',
    entityId: local.invoice.id,
    kind: 'update',
    baseVersion: 1,
    payload: local.invoice,
    createdAt: local.invoice.updatedAt,
    attempts: 0,
  }
  await repository.transactLocalMutation(mutation)

  await expect(repository.acknowledgeMutation(
    OWNER,
    mutation.id,
    [],
    () => true,
    true,
  )).rejects.toThrow(/scheduled a fresh bootstrap/i)

  await expect(repository.get('invoice', local.invoice.id)).resolves.toEqual(local.invoice)
  expect(raw.outbox.find((row) => row.mutation_id === mutation.id)?.state).toBe('pending')
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
  expect(raw.metadata).toEqual(expect.arrayContaining([
    expect.objectContaining({
      owner_id: OWNER,
      key: 'sync-feed-v2-reconciliation-required',
      value: 'true',
    }),
  ]))

  const staged = bundlePayload(4, SHARED_TIME, 'current', 'Fresh bootstrap')
  await repository.commitPull(
    OWNER,
    bundleRows(staged, [983, 984, 985]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 985, changeId: 985 }),
    true,
  )
  await repository.acknowledgeMutation(OWNER, mutation.id, [], () => true, true)

  await expect(repository.get('invoice', mutation.entityId)).resolves.toEqual(staged.invoice)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('preserves a later invoice intent during legacy feed repair and lets its receipt win', async () => {
  const { repository } = await initializeLegacyRepository('legacy-invoice-repair-later-intent.db')
  const firstBundle = bundlePayload(1, '2026-08-03T09:01:00.000Z', 'pending', 'First local')
  const secondBundle = bundlePayload(2, '2026-08-03T09:02:00.000Z', 'pending', 'Second local')
  const first: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000114',
    ownerId: OWNER,
    entity: 'invoice',
    entityId: firstBundle.invoice.id,
    kind: 'update',
    baseVersion: 1,
    payload: firstBundle.invoice,
    createdAt: firstBundle.invoice.updatedAt,
    attempts: 0,
  }
  const second: MutationEnvelope = {
    ...first,
    id: '00000000-0000-4000-8000-000000000115',
    baseVersion: 2,
    payload: secondBundle.invoice,
    createdAt: secondBundle.invoice.updatedAt,
  }
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)
  const staged = bundlePayload(4, SHARED_TIME, 'current', 'Staged server')
  await repository.commitPull(
    OWNER,
    bundleRows(staged, [990, 991, 992]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 992, changeId: 992 }),
    true,
  )

  await repository.acknowledgeMutation(OWNER, first.id, [], () => true, true)

  await expect(repository.get('invoice', second.entityId)).resolves.toEqual(second.payload)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)

  const canonical = bundlePayload(5, '2026-08-03T10:00:11.000Z', 'current', 'Second canonical')
  await repository.acknowledgeMutation(OWNER, second.id, [
    { ...bundleRows(canonical, [993, 994, 995])[2], changeId: 995 },
  ])

  await expect(repository.get('invoice', second.entityId)).resolves.toEqual(canonical.invoice)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
})

it('rolls back a legacy feed repair when the owner generation changes', async () => {
  const { raw, repository } = await initializeLegacyRepository('legacy-invoice-repair-rollback.db')
  const local = bundlePayload(1, '2026-08-03T09:01:00.000Z', 'pending', 'Legacy local')
  const mutation: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000116',
    ownerId: OWNER,
    entity: 'invoice',
    entityId: local.invoice.id,
    kind: 'update',
    baseVersion: 1,
    payload: local.invoice,
    createdAt: local.invoice.updatedAt,
    attempts: 0,
  }
  await repository.transactLocalMutation(mutation)
  const staged = bundlePayload(4, SHARED_TIME, 'current', 'Staged server')
  await repository.commitPull(
    OWNER,
    bundleRows(staged, [996, 997, 998]),
    JSON.stringify({ updatedAt: SHARED_TIME, changeSeq: 998, changeId: 998 }),
    true,
  )

  await expect(repository.acknowledgeMutation(
    OWNER,
    mutation.id,
    [],
    () => false,
    true,
  )).rejects.toThrow(/owner changed/i)

  await expect(repository.get('invoice', mutation.entityId)).resolves.toEqual(local.invoice)
  expect(raw.outbox.find((row) => row.mutation_id === mutation.id)?.state).toBe('pending')
  expect(raw.bootstrapRecords).toEqual(expect.arrayContaining([
    expect.objectContaining({ entity: 'invoice', entity_id: mutation.entityId, change_id: 998 }),
  ]))
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
})
