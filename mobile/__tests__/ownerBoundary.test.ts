jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
  __pauseNextRecordsRead,
  __resetSQLiteMock,
} from 'expo-sqlite'

import { OwnerBoundary } from '../src/data/ownerBoundary'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

beforeEach(() => {
  __resetSQLiteMock()
})

const mutationFor = (ownerId: string, entityId: string) => ({
  id:
    ownerId === 'owner-a'
      ? '00000000-0000-4000-8000-000000000010'
      : '00000000-0000-4000-8000-000000000011',
  ownerId,
  entity: 'client' as const,
  entityId,
  kind: 'create' as const,
  baseVersion: null,
  payload: {
    id: entityId,
    ownerId,
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending',
    name: ownerId,
  },
  createdAt: '2026-08-03T10:00:01.000Z',
  attempts: 0,
})

it('invalidates snapshots after data revisions and delete epochs', () => {
  const boundary = new OwnerBoundary()
  boundary.switchOwner('owner-a')
  const beforeMutation = boundary.capture()
  boundary.markDataChanged()
  const beforeDelete = boundary.capture()
  boundary.beginDelete('owner-a')

  expect(boundary.isCurrent(beforeMutation)).toBe(false)
  expect(boundary.isCurrent(beforeDelete)).toBe(false)
  expect(boundary.getSnapshot()).toEqual({
    ownerId: 'owner-a',
    dataRevision: 3,
    deleteEpoch: 1,
  })
})

it('discards an in-flight owner A read after switching to owner B', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'switch.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const paused = __pauseNextRecordsRead('switch.db')

  const staleRead = repository.list('client')
  await paused.started
  const switchOwner = repository.initialize('owner-b')
  expect(repository.ownerBoundary.getSnapshot().ownerId).toBeNull()
  await switchOwner
  paused.release()

  await expect(staleRead).resolves.toEqual([])
  await expect(repository.list('client')).resolves.toEqual([])
})

it('increments the delete epoch before deleting so an in-flight read cannot repopulate rows', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'delete-all.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const before = repository.ownerBoundary.getSnapshot()
  const paused = __pauseNextRecordsRead('delete-all.db')

  const staleRead = repository.list('client')
  await paused.started
  const clear = repository.clearOwner('owner-a')

  expect(repository.ownerBoundary.getSnapshot()).toEqual({
    ownerId: 'owner-a',
    dataRevision: before.dataRevision + 1,
    deleteEpoch: before.deleteEpoch + 1,
  })
  await clear
  paused.release()

  await expect(staleRead).resolves.toEqual([])
  await expect(repository.list('client')).resolves.toEqual([])
})

it('makes clear and close idempotent', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'lifecycle.db' })
  await repository.initialize('owner-a')

  await Promise.all([repository.clearOwner('owner-a'), repository.clearOwner('owner-a')])
  await Promise.all([repository.close(), repository.close()])

  await expect(repository.close()).resolves.toBeUndefined()
})

it('lets an already-started owner clear finish before close releases the database', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'clear-close.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))

  const clear = repository.clearOwner('owner-a')
  const close = repository.close()

  await expect(clear).resolves.toBeUndefined()
  await expect(close).resolves.toBeUndefined()
})
