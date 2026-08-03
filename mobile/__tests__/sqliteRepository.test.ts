jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
  __failNextOutboxInsert,
  __failNextMigration,
  __getRawDatabase,
  __resetSQLiteMock,
} from 'expo-sqlite'

import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

const OWNER = 'owner-a'
const MUTATION_ONE = '00000000-0000-4000-8000-000000000001'
const MUTATION_TWO = '00000000-0000-4000-8000-000000000002'

const client = (overrides: Record<string, unknown> = {}) => ({
  id: 'client-1',
  ownerId: OWNER,
  version: 1,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
  syncState: 'pending',
  name: 'Jordan Lee',
  ...overrides,
})

const mutation = (overrides: Record<string, unknown> = {}) => ({
  id: MUTATION_ONE,
  ownerId: OWNER,
  entity: 'client' as const,
  entityId: 'client-1',
  kind: 'create' as const,
  baseVersion: null,
  payload: client(),
  createdAt: '2026-08-03T10:00:01.000Z',
  attempts: 0,
  ...overrides,
})

beforeEach(() => {
  __resetSQLiteMock()
})

it('applies schema version 1 with every required table', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'migration.db' })

  await repository.initialize(OWNER)

  const raw = __getRawDatabase('migration.db')
  expect(raw.userVersion).toBe(1)
  expect([...raw.tables].sort()).toEqual([
    'conflicts',
    'metadata',
    'outbox',
    'records',
    'sync_cursors',
  ])
})

it('leaves the schema version and tables unchanged when migration fails', async () => {
  __failNextMigration('failed-migration.db')
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'failed-migration.db' })

  await expect(repository.initialize(OWNER)).rejects.toThrow('migration')

  const raw = __getRawDatabase('failed-migration.db')
  expect(raw.userVersion).toBe(0)
  expect([...raw.tables]).toEqual([])
})

it('rolls back the cached row when the matching outbox insertion fails', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'rollback.db' })
  await repository.initialize(OWNER)
  __failNextOutboxInsert('rollback.db')

  await expect(repository.transactLocalMutation(mutation())).rejects.toThrow('outbox')

  await expect(repository.get('client', 'client-1')).resolves.toBeNull()
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
})

it('rejects a non-UUID mutation id before writing cache state', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'uuid.db' })
  await repository.initialize(OWNER)

  await expect(repository.transactLocalMutation(mutation({ id: 'not-a-uuid' }))).rejects.toThrow()
  await expect(repository.get('client', 'client-1')).resolves.toBeNull()
})

it('accepts a canonically equivalent duplicate mutation ID exactly once', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'duplicate.db' })
  await repository.initialize(OWNER)

  await repository.transactLocalMutation(mutation())
  const reversedPayload = Object.fromEntries(Object.entries(client()).reverse())
  await repository.transactLocalMutation(
    mutation({ payload: reversedPayload }),
  )

  await expect(repository.outbox.list(OWNER)).resolves.toHaveLength(1)
})

it('rejects a duplicate mutation ID whose canonical content differs', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'corrupt-duplicate.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())

  await expect(
    repository.transactLocalMutation(mutation({ payload: client({ name: 'Different' }) })),
  ).rejects.toThrow(/corruption/i)

  await expect(repository.get<{ name: string }>('client', 'client-1')).resolves.toMatchObject({
    name: 'Jordan Lee',
  })
})

it('rejects corrupt persisted JSON instead of returning partial cache state', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'corrupt-json.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())
  __getRawDatabase('corrupt-json.db').records[0].payload_json = '{bad json'

  await expect(repository.list('client')).rejects.toThrow(/corrupt/i)
})

it('persists a delete tombstone and hides the deleted row', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'delete.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())

  await repository.transactLocalMutation(
    mutation({
      id: MUTATION_TWO,
      kind: 'delete',
      baseVersion: 1,
      payload: null,
      createdAt: '2026-08-03T10:00:02.000Z',
    }),
  )

  await expect(repository.get('client', 'client-1')).resolves.toBeNull()
  expect(__getRawDatabase('delete.db').records).toContainEqual(
    expect.objectContaining({ owner_id: OWNER, entity_id: 'client-1', deleted: 1 }),
  )
  await expect(repository.outbox.list(OWNER)).resolves.toHaveLength(2)
})

it('rejects cloud rows whose validated payload version disagrees with the envelope', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'cloud-version.db' })
  await repository.initialize(OWNER)

  await expect(
    repository.applyCloudRows([
      {
        ownerId: OWNER,
        entity: 'client',
        entityId: 'client-1',
        payload: client(),
        version: 2,
        updatedAt: '2026-08-03T10:00:00.000Z',
      },
    ]),
  ).rejects.toThrow(/version/i)

  await expect(repository.get('client', 'client-1')).resolves.toBeNull()
})

it('rejects non-entity conflict payloads before persisting them', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'conflict-validation.db' })
  await repository.initialize(OWNER)

  await expect(
    repository.markConflict({
      mutationId: MUTATION_ONE,
      entity: 'client',
      entityId: 'client-1',
      localPayload: 'not a client',
      cloudPayload: client({ syncState: 'conflict' }),
      cloudVersion: 2,
    }),
  ).rejects.toThrow()

  expect(__getRawDatabase('conflict-validation.db').conflicts).toEqual([])
})
