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
import { SyncCoordinator } from '../src/data/syncCoordinator'

const OWNER = 'owner-a'
const DATABASE = 'legacy-feed-upgrade.db'
const SHARED_TIME = '2026-08-03T10:00:10.000Z'

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
      change_id: changeId,
      owner_id: OWNER,
      entity: 'client',
      entity_id: id,
      version: 2,
      payload: rawClient(id, name, 2),
      deleted: false,
      updated_at: SHARED_TIME,
    }],
    cursor: { updated_at: SHARED_TIME, change_id: changeId },
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
): CloudRowEnvelope => ({
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
})

const tombstone = (
  entity: CloudRowEnvelope['entity'],
  entityId: string,
  version: number,
  updatedAt: string,
): CloudRowEnvelope => ({
  ownerId: OWNER,
  entity,
  entityId,
  payload: null,
  version,
  updatedAt,
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

const bundleRows = (bundle: InvoiceBundlePayload): CloudRowEnvelope[] => (
  (['client', 'job', 'invoice'] as const).map((entity) => ({
    ownerId: OWNER,
    entity,
    entityId: bundle[entity].id,
    payload: bundle[entity],
    version: bundle[entity].version,
    updatedAt: bundle[entity].updatedAt,
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
  expect(raw.userVersion).toBe(2)
  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)

  const client = new Client()
  client.replies = [feedReply(101, 'client-server-a', 'Server A', true)]
  const gateway = createSupabaseGateway(client)
  const pageOne = await gateway.pullSince(OWNER, null, new AbortController().signal)
  await repository.commitPull(OWNER, pageOne.rows, pageOne.cursor, false)

  await expect(repository.get('client', 'client-server-a')).resolves.toBeNull()
  await expect(repository.get('client', 'client-stale')).resolves.not.toBeNull()
  await expect(repository.get('client', 'client-local')).resolves.toMatchObject({
    name: 'Unsynced local edit', syncState: 'pending',
  })
  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(pageOne.cursor)

  client.replies = [feedReply(102, 'client-server-b', 'Server B', false)]
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
    feedReply(102, 'client-server-b', 'Server B', false),
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
    expect.objectContaining({ parameters: { p_cursor_updated_at: null, p_cursor_change_id: null, p_limit: 500 } }),
    expect.objectContaining({ parameters: { p_cursor_updated_at: SHARED_TIME, p_cursor_change_id: 101, p_limit: 500 } }),
    expect.objectContaining({ parameters: { p_cursor_updated_at: SHARED_TIME, p_cursor_change_id: 101, p_limit: 500 } }),
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

  const applied = clientEnvelope('receipt-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z')
  const newer = clientEnvelope('receipt-client', 'Newer remote edit', 3, '2026-08-03T10:00:02.000Z')
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    { rows: [applied], cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeId":100}', hasMore: true },
    { rows: [newer], cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":101}', hasMore: false },
  ]
  gateway.pushes = [{ type: 'applied', rows: [applied] }]

  const coordinator = await runCoordinator(repository, gateway)

  await expect(repository.get('client', 'receipt-client')).resolves.toMatchObject({
    name: 'Newer remote edit', version: 3, syncState: 'current',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)
  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":101}',
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

  const applied = clientEnvelope('deleted-receipt-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z')
  const deleted = tombstone('client', 'deleted-receipt-client', 2, '2026-08-03T10:00:03.000Z')
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    { rows: [applied], cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeId":200}', hasMore: true },
    { rows: [deleted], cursor: '{"updatedAt":"2026-08-03T10:00:03.000Z","changeId":201}', hasMore: false },
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
  const newerClient = clientEnvelope('bundle-client', 'Newer remote client', 3, '2026-08-03T10:00:04.000Z')
  const deletedJob = tombstone('job', 'bundle-job', 2, '2026-08-03T10:00:05.000Z')
  const deletedInvoice = tombstone('invoice', 'bundle-invoice', 2, '2026-08-03T10:00:06.000Z')
  const gateway = new ScriptedGateway()
  gateway.pulls = [
    {
      rows: bundleRows(appliedBundle),
      cursor: '{"updatedAt":"2026-08-03T10:00:01.000Z","changeId":300}',
      hasMore: true,
    },
    {
      rows: [newerClient, deletedJob, deletedInvoice],
      cursor: '{"updatedAt":"2026-08-03T10:00:06.000Z","changeId":303}',
      hasMore: false,
    },
  ]
  gateway.pushes = [{ type: 'applied', rows: bundleRows(appliedBundle) }]

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

  const serverGeneric = clientEnvelope('unsent-client', 'Preexisting server client', 1, '2026-08-03T10:00:01.000Z')
  const serverBundle = bundlePayload(1, '2026-08-03T10:00:02.000Z', 'current', 'Preexisting server')
  const genericApplied = clientEnvelope('unsent-client', 'Unsent client', 2, '2026-08-03T10:00:10.000Z')
  const bundleApplied = bundlePayload(2, '2026-08-03T10:00:11.000Z', 'current', 'Local')
  const gateway = new ScriptedGateway()
  gateway.pulls = [{
    rows: [serverGeneric, ...bundleRows(serverBundle)],
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":403}',
    hasMore: false,
  }]
  gateway.pushes = [
    { type: 'applied', rows: [genericApplied] },
    { type: 'applied', rows: bundleRows(bundleApplied) },
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
  const applied = clientEnvelope('crash-client', 'Applied before crash', 2, '2026-08-03T10:00:01.000Z')
  const newer = clientEnvelope('crash-client', 'Newer after receipt', 3, '2026-08-03T10:00:02.000Z')

  await repository.commitPull(
    OWNER,
    [applied, newer],
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":501}',
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
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":501}',
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
  const applied = clientEnvelope('generation-client', 'Old receipt', 2, '2026-08-03T10:00:01.000Z')
  const newer = clientEnvelope('generation-client', 'Newer staged row', 3, '2026-08-03T10:00:02.000Z')
  await repository.commitPull(
    OWNER,
    [newer],
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":601}',
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
  const conflictCloud = clientEnvelope('conflict-client', 'Conflict response row', 2, '2026-08-03T10:00:01.000Z')
  const newer = clientEnvelope('conflict-client', 'Later staged authority', 3, '2026-08-03T10:00:02.000Z')
  await repository.commitPull(
    OWNER,
    [newer],
    '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":701}',
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
    cloudVersion: 2,
  })

  await repository.resolveConflictKeepCloud(mutation.id)

  await expect(repository.get('client', 'conflict-client')).resolves.toMatchObject({
    name: 'Later staged authority', version: 3,
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
    cursor: '{"updatedAt":"2026-08-03T10:00:02.000Z","changeId":801}',
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
