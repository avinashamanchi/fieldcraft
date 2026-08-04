jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
  randomUUID: () => '00000000-0000-4000-8000-000000000099',
}))

import { __getRawDatabase, __resetSQLiteMock, openDatabaseAsync } from 'expo-sqlite'

import type { MutationEnvelope } from '../src/domain/sync'
import { canonicalStringify, hashMutationEnvelope } from '../src/data/outbox'
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
