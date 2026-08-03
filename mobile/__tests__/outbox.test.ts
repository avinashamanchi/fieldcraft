jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
  __getRawDatabase,
  __pauseNextOutboxRead,
  __resetSQLiteMock,
  openDatabaseAsync,
} from 'expo-sqlite'

import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

beforeEach(() => {
  __resetSQLiteMock()
})

const makeMutation = (id: string, entityId: string) => ({
  id,
  ownerId: 'owner-a',
  entity: 'client' as const,
  entityId,
  kind: 'create' as const,
  baseVersion: null,
  payload: {
    id: entityId,
    ownerId: 'owner-a',
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending',
    name: entityId,
  },
  createdAt: '2026-08-03T10:00:00.000Z',
  attempts: 0,
})

it('returns pending mutations in durable insertion order when timestamps tie', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'fifo.db' })
  await repository.initialize('owner-a')

  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000099', 'client-z'),
  )
  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000001', 'client-a'),
  )

  await expect(repository.outbox.list('owner-a')).resolves.toEqual([
    expect.objectContaining({ id: '00000000-0000-4000-8000-000000000099' }),
    expect.objectContaining({ id: '00000000-0000-4000-8000-000000000001' }),
  ])
})

it('scopes mutation IDs and FIFO sequences independently per owner', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'owner-outbox.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000005', 'client-a'),
  )

  await repository.initialize('owner-b')
  await repository.transactLocalMutation({
    ...makeMutation('00000000-0000-4000-8000-000000000005', 'client-b'),
    ownerId: 'owner-b',
    payload: {
      ...makeMutation('00000000-0000-4000-8000-000000000006', 'client-b').payload,
      ownerId: 'owner-b',
    },
  })

  await expect(repository.outbox.list('owner-a')).rejects.toThrow(/active owner/i)
  await expect(repository.outbox.list('owner-b')).resolves.toHaveLength(1)
  await repository.initialize('owner-a')
  await expect(repository.outbox.list('owner-a')).resolves.toHaveLength(1)
})

it('serializes concurrent distinct mutations into unique FIFO sequences', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'concurrent.db' })
  await repository.initialize('owner-a')

  await Promise.all([
    repository.transactLocalMutation(
      makeMutation('00000000-0000-4000-8000-000000000031', 'client-1'),
    ),
    repository.transactLocalMutation(
      makeMutation('00000000-0000-4000-8000-000000000032', 'client-2'),
    ),
  ])

  expect(__getRawDatabase('concurrent.db').outbox.map((row) => row.sequence)).toEqual([1, 2])
  await expect(repository.outbox.list('owner-a')).resolves.toHaveLength(2)
})

it('serializes owner-local FIFO allocation across separate SQLite connections', async () => {
  const firstRepository = new SQLiteFieldCraftRepository({ databaseName: 'multi-connection.db' })
  const secondRepository = new SQLiteFieldCraftRepository({ databaseName: 'multi-connection.db' })
  await Promise.all([
    firstRepository.initialize('owner-a'),
    secondRepository.initialize('owner-a'),
  ])

  await Promise.all([
    firstRepository.transactLocalMutation(
      makeMutation('00000000-0000-4000-8000-000000000033', 'client-3'),
    ),
    secondRepository.transactLocalMutation(
      makeMutation('00000000-0000-4000-8000-000000000034', 'client-4'),
    ),
  ])

  expect(__getRawDatabase('multi-connection.db').outbox.map((row) => row.sequence)).toEqual([1, 2])
})

it('rejects duplicate owner-local FIFO sequence values in the SQLite adapter', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'sequence-constraint.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000041', 'client-1'),
  )
  const database = await openDatabaseAsync('sequence-constraint.db')

  await expect(
    database.runAsync(
      `/* outbox:insert */ INSERT INTO outbox
       (owner_id, mutation_id, sequence, entity, entity_id, kind, base_version,
        payload_json, payload_hash, created_at, attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'owner-a',
        '00000000-0000-4000-8000-000000000042',
        1,
        'client',
        'client-2',
        'create',
        null,
        '{}',
        'hash',
        '2026-08-03T10:00:00.000Z',
        0,
      ],
    ),
  ).rejects.toThrow(/sequence/i)
})

it('fails closed when schema-valid outbox content no longer matches its immutable hash', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'hash-tamper.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000051', 'client-1'),
  )
  const row = __getRawDatabase('hash-tamper.db').outbox[0]
  row.payload_json = JSON.stringify({ ...makeMutation(row.mutation_id, 'client-1').payload, name: 'Tampered' })

  await expect(repository.outbox.list('owner-a')).rejects.toThrow(/corrupt/i)
})

it('discards an in-flight outbox read after the owner changes', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'stale-outbox.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000061', 'client-1'),
  )
  const paused = __pauseNextOutboxRead('stale-outbox.db')

  const stale = repository.outbox.list('owner-a')
  await paused.started
  const switched = repository.initialize('owner-b')
  paused.release()
  await switched

  await expect(stale).resolves.toEqual([])
})

it('drains an accepted outbox read before concurrent closes deactivate the shared owner', async () => {
  const reading = new SQLiteFieldCraftRepository({ databaseName: 'closing-outbox.db' })
  const idle = new SQLiteFieldCraftRepository({ databaseName: 'closing-outbox.db' })
  await Promise.all([reading.initialize('owner-a'), idle.initialize('owner-a')])
  await reading.transactLocalMutation(
    makeMutation('00000000-0000-4000-8000-000000000062', 'client-1'),
  )
  const paused = __pauseNextOutboxRead('closing-outbox.db')

  const inFlight = reading.outbox.list('owner-a')
  await paused.started
  const readingClose = reading.close()
  await idle.close()
  const ownerWhileReading = reading.ownerBoundary.getSnapshot().ownerId
  paused.release()

  await expect(inFlight).resolves.toHaveLength(1)
  await readingClose
  expect(ownerWhileReading).toBe('owner-a')
  expect(reading.ownerBoundary.getSnapshot().ownerId).toBeNull()
  expect(__getRawDatabase('closing-outbox.db').closeCount).toBe(2)
})

it('rejects comment-routed malformed SQL and ownerless queries in the SQLite adapter', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'strict-sql.db' })
  await repository.initialize('owner-a')
  const database = await openDatabaseAsync('strict-sql.db')

  await expect(database.runAsync('/* records:upsert */ SELECT 1', [])).rejects.toThrow(/SQL/i)
  await expect(
    database.getAllAsync(
      '/* records:list */ SELECT entity_id, payload_json FROM records WHERE entity = ?',
      ['client'],
    ),
  ).rejects.toThrow(/SQL|statement|owner_id/i)
  await expect(
    database.execAsync('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY)'),
  ).rejects.toThrow(/owner.scoped|owner_id/i)
  await expect(
    database.getAllAsync(
      `/* records:list */ SELECT entity_id, payload_json FROM records
       WHERE owner_id = ? OR entity = ? AND deleted = 0`,
      ['owner-a', 'client'],
    ),
  ).rejects.toThrow(/OR|boolean|owner/i)
  const validTail = `SELECT entity_id, payload_json FROM records
    WHERE owner_id = ? AND entity = ? AND deleted = 0
    ORDER BY updated_at DESC, entity_id ASC`
  await expect(
    database.getAllAsync(
      `/* records:list */ SELECT entity_id, payload_json FROM records
       UNION ${validTail}`,
      ['owner-a', 'client'],
    ),
  ).rejects.toThrow(/SQL|statement|UNION/i)
  await expect(
    database.getAllAsync(`SELECT 1; /* records:list */ ${validTail}`, ['owner-a', 'client']),
  ).rejects.toThrow(/SQL|statement|prefix/i)
  await expect(
    database.getAllAsync(
      `/* records:list */ SELECT entity_id, payload_json FROM records
       WHERE owner_id = ? AND (entity = ? AND deleted = 0)
       ORDER BY updated_at DESC, entity_id ASC`,
      ['owner-a', 'client'],
    ),
  ).rejects.toThrow(/SQL|WHERE|group/i)
})
