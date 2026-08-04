jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
  __failNextOwnerClear,
  __getRawDatabase,
  __pauseNextMigrationRead,
  __pauseNextOwnerClear,
  __pauseNextOutboxInsert,
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

it('blocks new owner reads and mutations while clear is pending', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'pending-clear.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const paused = __pauseNextOwnerClear('pending-clear.db')

  const clear = repository.clearOwner('owner-a')
  await paused.started

  await expect(repository.list('client')).rejects.toThrow(/clear/i)
  await expect(
    repository.transactLocalMutation({
      ...mutationFor('owner-a', 'client-b'),
      id: '00000000-0000-4000-8000-000000000012',
    }),
  ).rejects.toThrow(/clear/i)
  paused.release()
  await clear
})

it('keeps a failed clear fail-closed until an explicit clear retry succeeds', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'failed-clear.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  __failNextOwnerClear('failed-clear.db')

  await expect(repository.clearOwner('owner-a')).rejects.toThrow(/clear/i)
  expect(__getRawDatabase('failed-clear.db').records).toHaveLength(1)
  await expect(repository.get('client', 'client-a')).rejects.toThrow(/clear/i)
  await expect(repository.clearOwner('owner-a')).resolves.toBeUndefined()
  await expect(repository.get('client', 'client-a')).resolves.toBeNull()
})

it('rolls back a mutation already in flight when owner clear advances the epoch', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'clear-mutation-race.db' })
  await repository.initialize('owner-a')
  const paused = __pauseNextOutboxInsert('clear-mutation-race.db')

  const mutation = repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  await paused.started
  const clear = repository.clearOwner('owner-a')
  paused.release()

  await expect(mutation).rejects.toThrow(/owner changed/i)
  await expect(clear).resolves.toBeUndefined()
  expect(__getRawDatabase('clear-mutation-race.db').records).toEqual([])
  expect(__getRawDatabase('clear-mutation-race.db').outbox).toEqual([])
})

it('clears only the requested owner partition across owner-scoped tables', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'scoped-clear.db' })
  await repository.initialize('owner-a')
  await repository.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  await repository.initialize('owner-b')
  await repository.transactLocalMutation(mutationFor('owner-b', 'client-b'))
  const raw = __getRawDatabase('scoped-clear.db')
  raw.conflicts.push({ owner_id: 'owner-a' }, { owner_id: 'owner-b' })
  raw.syncCursors.push({ owner_id: 'owner-a' }, { owner_id: 'owner-b' })
  raw.metadata.push({ owner_id: 'owner-a' }, { owner_id: 'owner-b' })

  await repository.clearOwner('owner-a')

  expect(raw.records).toEqual([expect.objectContaining({ owner_id: 'owner-b' })])
  expect(raw.outbox).toEqual([expect.objectContaining({ owner_id: 'owner-b' })])
  expect(raw.conflicts).toEqual([{ owner_id: 'owner-b' }])
  expect(raw.syncCursors).toEqual([{ owner_id: 'owner-b' }])
  expect(raw.metadata).toEqual([{ owner_id: 'owner-b' }])
})

it('shares pending clear gates across repositories using the same database', async () => {
  const first = new SQLiteFieldCraftRepository({ databaseName: 'shared-pending-clear.db' })
  const second = new SQLiteFieldCraftRepository({ databaseName: 'shared-pending-clear.db' })
  await Promise.all([first.initialize('owner-a'), second.initialize('owner-a')])
  await first.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const paused = __pauseNextOwnerClear('shared-pending-clear.db')

  const clear = first.clearOwner('owner-a')
  await paused.started

  await expect(second.list('client')).rejects.toThrow(/clear/i)
  await expect(
    second.transactLocalMutation({
      ...mutationFor('owner-a', 'client-b'),
      id: '00000000-0000-4000-8000-000000000013',
    }),
  ).rejects.toThrow(/clear/i)
  paused.release()
  await clear
})

it('shares failed-clear denial and successful retry across repository instances', async () => {
  const first = new SQLiteFieldCraftRepository({ databaseName: 'shared-failed-clear.db' })
  const second = new SQLiteFieldCraftRepository({ databaseName: 'shared-failed-clear.db' })
  await Promise.all([first.initialize('owner-a'), second.initialize('owner-a')])
  await first.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  __failNextOwnerClear('shared-failed-clear.db')

  await expect(first.clearOwner('owner-a')).rejects.toThrow(/clear/i)
  await expect(second.get('client', 'client-a')).rejects.toThrow(/clear failed/i)
  await expect(second.clearOwner('owner-a')).resolves.toBeUndefined()
  await expect(first.get('client', 'client-a')).resolves.toBeNull()

  await expect(
    second.transactLocalMutation({
      ...mutationFor('owner-a', 'client-new'),
      id: '00000000-0000-4000-8000-000000000014',
    }),
  ).resolves.toBeUndefined()
})

it('closing one attached repository leaves its peer owner, reads, writes, and outbox active', async () => {
  const first = new SQLiteFieldCraftRepository({ databaseName: 'peer-close.db' })
  const second = new SQLiteFieldCraftRepository({ databaseName: 'peer-close.db' })
  await Promise.all([first.initialize('owner-a'), second.initialize('owner-a')])
  await first.transactLocalMutation(mutationFor('owner-a', 'client-a'))

  await first.close()

  await expect(first.list('client')).rejects.toThrow(/closed|closing/i)
  await expect(first.outbox.list('owner-a')).rejects.toThrow(/closed|closing/i)
  await expect(second.list('client')).resolves.toHaveLength(1)
  await expect(
    second.transactLocalMutation({
      ...mutationFor('owner-a', 'client-b'),
      id: '00000000-0000-4000-8000-000000000015',
    }),
  ).resolves.toBeUndefined()
  await expect(second.outbox.list('owner-a')).resolves.toHaveLength(2)

  await second.close()
  expect(second.ownerBoundary.getSnapshot().ownerId).toBeNull()
  await expect(second.list('client')).rejects.toThrow(/closed|closing|active owner/i)
})

it('a peer in-flight read completes when a different repository connection closes', async () => {
  const closing = new SQLiteFieldCraftRepository({ databaseName: 'peer-inflight-close.db' })
  const reading = new SQLiteFieldCraftRepository({ databaseName: 'peer-inflight-close.db' })
  await Promise.all([closing.initialize('owner-a'), reading.initialize('owner-a')])
  await reading.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const paused = __pauseNextRecordsRead('peer-inflight-close.db')

  const inFlight = reading.list('client')
  await paused.started
  await closing.close()
  paused.release()

  await expect(inFlight).resolves.toHaveLength(1)
  await expect(reading.list('client')).resolves.toHaveLength(1)
  await reading.close()
})

it('drains a pre-database mutation before concurrent closes deactivate the shared owner', async () => {
  const writing = new SQLiteFieldCraftRepository({ databaseName: 'concurrent-close-write.db' })
  const idle = new SQLiteFieldCraftRepository({ databaseName: 'concurrent-close-write.db' })
  await Promise.all([writing.initialize('owner-a'), idle.initialize('owner-a')])
  let nullTransitions = 0
  const unsubscribe = writing.ownerBoundary.subscribe(() => {
    if (writing.ownerBoundary.getSnapshot().ownerId === null) nullTransitions += 1
  })

  // Hashing is asynchronous, so this operation has been accepted before it joins the write queue.
  const mutation = writing.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const writingClose = writing.close()
  const deniedRead = writing.list('client')
  const idleClose = idle.close()

  await expect(deniedRead).rejects.toThrow(/closed|closing/i)
  await expect(mutation).resolves.toBeUndefined()
  await Promise.all([writingClose, idleClose])

  expect(__getRawDatabase('concurrent-close-write.db').records).toHaveLength(1)
  expect(__getRawDatabase('concurrent-close-write.db').outbox).toHaveLength(1)
  expect(writing.ownerBoundary.getSnapshot().ownerId).toBeNull()
  expect(nullTransitions).toBe(1)
  expect(__getRawDatabase('concurrent-close-write.db').closeCount).toBe(2)

  await Promise.all([writing.close(), idle.close()])
  expect(__getRawDatabase('concurrent-close-write.db').closeCount).toBe(2)
  unsubscribe()
})

it.each([
  ['reading attachment closes first', 'concurrent-close-read-first.db', true],
  ['idle attachment closes first', 'concurrent-close-idle-first.db', false],
] as const)('keeps an in-flight read valid when the %s', async (_label, databaseName, readingClosesFirst) => {
  const reading = new SQLiteFieldCraftRepository({ databaseName })
  const idle = new SQLiteFieldCraftRepository({ databaseName })
  await Promise.all([reading.initialize('owner-a'), idle.initialize('owner-a')])
  await reading.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const paused = __pauseNextRecordsRead(databaseName)

  const inFlightRead = reading.list('client')
  await paused.started
  const firstClose = readingClosesFirst ? reading.close() : idle.close()
  const secondClose = readingClosesFirst ? idle.close() : reading.close()
  const readingClose = readingClosesFirst ? firstClose : secondClose
  const idleClose = readingClosesFirst ? secondClose : firstClose
  await idleClose
  const ownerWhileReading = reading.ownerBoundary.getSnapshot().ownerId
  paused.release()

  await expect(inFlightRead).resolves.toHaveLength(1)
  await readingClose
  expect(ownerWhileReading).toBe('owner-a')
  expect(reading.ownerBoundary.getSnapshot().ownerId).toBeNull()
  expect(__getRawDatabase(databaseName).closeCount).toBe(2)
})

it('lets a replacement attachment arrive during shared drain without an owner deactivation gap', async () => {
  const writing = new SQLiteFieldCraftRepository({ databaseName: 'replacement-during-drain.db' })
  const idle = new SQLiteFieldCraftRepository({ databaseName: 'replacement-during-drain.db' })
  await Promise.all([writing.initialize('owner-a'), idle.initialize('owner-a')])
  const paused = __pauseNextOutboxInsert('replacement-during-drain.db')
  let nullTransitions = 0
  const unsubscribe = writing.ownerBoundary.subscribe(() => {
    if (writing.ownerBoundary.getSnapshot().ownerId === null) nullTransitions += 1
  })

  const mutation = writing.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  await paused.started
  const writingClose = writing.close()
  await idle.close()

  const replacement = new SQLiteFieldCraftRepository({ databaseName: 'replacement-during-drain.db' })
  const replacementInitialization = replacement.initialize('owner-a')
  const nullTransitionsBeforeFinalClose = nullTransitions
  paused.release()

  await expect(mutation).resolves.toBeUndefined()
  await writingClose
  await replacementInitialization
  await expect(replacement.list('client')).resolves.toHaveLength(1)
  expect(replacement.ownerBoundary.getSnapshot().ownerId).toBe('owner-a')
  expect(nullTransitionsBeforeFinalClose).toBe(0)

  await replacement.close()
  expect(nullTransitions).toBe(1)
  expect(__getRawDatabase('replacement-during-drain.db').closeCount).toBe(3)
  unsubscribe()
})

it('deactivates exactly once when a replacement attachment fails initialization during drain', async () => {
  const draining = new SQLiteFieldCraftRepository({ databaseName: 'failed-replacement.db' })
  const idle = new SQLiteFieldCraftRepository({ databaseName: 'failed-replacement.db' })
  await Promise.all([draining.initialize('owner-a'), idle.initialize('owner-a')])
  await draining.transactLocalMutation(mutationFor('owner-a', 'client-a'))
  const readPause = __pauseNextRecordsRead('failed-replacement.db')
  const inFlightRead = draining.list('client')
  await readPause.started
  let nullTransitions = 0
  const unsubscribe = draining.ownerBoundary.subscribe(() => {
    if (draining.ownerBoundary.getSnapshot().ownerId === null) nullTransitions += 1
  })

  const drainingClose = draining.close()
  await idle.close()
  const raw = __getRawDatabase('failed-replacement.db')
  raw.userVersion = 5
  const migrationPause = __pauseNextMigrationRead('failed-replacement.db')
  const replacement = new SQLiteFieldCraftRepository({ databaseName: 'failed-replacement.db' })
  const replacementInitialization = replacement.initialize('owner-a')
  await migrationPause.started

  readPause.release()
  await expect(inFlightRead).resolves.toHaveLength(1)
  await drainingClose
  const ownerWhileReplacementWasOpening = draining.ownerBoundary.getSnapshot().ownerId
  migrationPause.release()

  await expect(replacementInitialization).rejects.toThrow(/newer|schema/i)
  expect(ownerWhileReplacementWasOpening).toBe('owner-a')
  expect(draining.ownerBoundary.getSnapshot().ownerId).toBeNull()
  expect(nullTransitions).toBe(1)
  expect(raw.closeCount).toBe(3)

  await replacement.close()
  expect(raw.closeCount).toBe(3)
  unsubscribe()
})
