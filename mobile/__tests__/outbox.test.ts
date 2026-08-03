jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import { __resetSQLiteMock } from 'expo-sqlite'

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

  await expect(repository.outbox.list('owner-a')).resolves.toHaveLength(1)
  await expect(repository.outbox.list('owner-b')).resolves.toHaveLength(1)
})
