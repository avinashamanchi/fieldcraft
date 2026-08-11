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

const mutation = (index: number) => {
  const suffix = String(index).padStart(12, '0')
  const entityId = `client-${String(index).padStart(3, '0')}`
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
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
      syncState: 'pending' as const,
      name: entityId,
    },
    createdAt: '2026-08-03T10:00:00.000Z',
    attempts: 0,
  }
}

it('pages 49, 50, and 51 records with a stable equal-timestamp keyset', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'page-boundaries.db' })
  await repository.initialize('owner-a')
  for (let index = 51; index >= 1; index -= 1) {
    await repository.transactLocalMutation(mutation(index))
  }

  const first = await repository.listPage<{ id: string }>('client', { limit: 50, after: null })
  expect(first.items).toHaveLength(50)
  expect(first.items.map(({ id }) => id)).toEqual(
    Array.from({ length: 50 }, (_value, index) => `client-${String(index + 1).padStart(3, '0')}`),
  )
  expect(first.next).toEqual({
    updatedAt: '2026-08-03T10:00:00.000Z',
    id: 'client-050',
  })

  const second = await repository.listPage<{ id: string }>('client', {
    limit: 50,
    after: first.next,
  })
  expect(second.items).toEqual([expect.objectContaining({ id: 'client-051' })])
  expect(second.next).toBeNull()

  await expect(repository.listPage('client', { limit: 51, after: null }))
    .rejects.toThrow('PAGE_LIMIT')
  await expect(repository.listPage('client', { limit: 0, after: null }))
    .rejects.toThrow('PAGE_LIMIT')
})

it('discards a completed page when the active owner changes during its read', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'page-owner-switch.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutation(1))

  await repository.initialize('owner-b')
  await expect(repository.listPage('client', { limit: 50, after: null })).resolves.toEqual({
    items: [],
    next: null,
  })
})
