jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import { __resetSQLiteMock } from 'expo-sqlite'

import type { MutationEnvelope } from '../src/domain/sync'
import type { CloudRowEnvelope } from '../src/data/repository'
import type { RemoteGateway } from '../src/data/remoteGateway'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import { SyncCoordinator, type SyncRepository } from '../src/data/syncCoordinator'

const OWNER = 'owner-a'
const resumeCursor = JSON.stringify({
  updatedAt: '2026-08-07T12:00:00.000Z',
  changeSeq: 9_000,
  changeId: 90_000,
})

beforeEach(() => {
  __resetSQLiteMock()
})

class RecoveryRepository implements SyncRepository {
  readonly outbox = { list: async (): Promise<MutationEnvelope[]> => [] }
  cursor: string | null = JSON.stringify({
    updatedAt: '2026-01-01T00:00:00.000Z', changeSeq: 1, changeId: 1,
  })
  preservedOutbox = false
  snapshotCursor: string | null = null
  snapshotWatermark: number | null = null
  committedSnapshotPages = 0

  async getSyncCursor(): Promise<string | null> { return this.cursor }
  async commitPull(_owner: string, _rows: CloudRowEnvelope[], cursor: string): Promise<void> {
    this.cursor = cursor
  }
  async beginSnapshotReset(_owner: string, watermark: number): Promise<string | null> {
    this.preservedOutbox = true
    this.snapshotWatermark = watermark
    return this.snapshotCursor
  }
  async commitSnapshotPage(
    _owner: string,
    _rows: CloudRowEnvelope[],
    cursor: string | null,
    _watermark: number,
    hasMore: boolean,
    nextResumeCursor: string,
  ): Promise<void> {
    this.committedSnapshotPages += 1
    this.snapshotCursor = cursor
    if (!hasMore) this.cursor = nextResumeCursor
  }
  async acknowledgeMutation(): Promise<void> {}
  async recordMutationFailure(): Promise<void> {}
  async recordMutationConflict(): Promise<void> {}
  async countConflicts(): Promise<number> { return 0 }
}

class RecoveryGateway implements RemoteGateway {
  snapshotCalls = 0
  async pullSince(): Promise<any> {
    if (this.snapshotCalls === 0) {
      return { type: 'cursorExpired', snapshotWatermark: 9_000, snapshotCursor: null }
    }
    return { type: 'page', rows: [], cursor: resumeCursor, hasMore: false }
  }
  async pullSnapshot(): Promise<any> {
    this.snapshotCalls += 1
    const hasMore = this.snapshotCalls < 11
    return {
      rows: [],
      cursor: hasMore ? JSON.stringify({ entity: 'client', id: `client-${this.snapshotCalls}` }) : null,
      hasMore,
      snapshotWatermark: 9_000,
      resumeCursor,
    }
  }
  async pushMutation(): Promise<any> { return { type: 'applied', rows: [] } }
  subscribeToOwner(): { unsubscribe(): void } { return { unsubscribe() {} } }
}

it('stages a cursor-expired snapshot, preserves outbox, and yields after ten pages', async () => {
  const repository = new RecoveryRepository()
  const gateway = new RecoveryGateway()
  let yields = 0
  const coordinator = new SyncCoordinator({
    repository,
    gateway,
    refreshAuthentication: async () => {},
    yieldControl: async () => { yields += 1 },
  } as never)

  await coordinator.setLifecycle({
    ownerId: OWNER, authenticated: true, foreground: true, online: true,
  })
  await coordinator.whenIdle()

  expect(repository).toMatchObject({
    preservedOutbox: true,
    snapshotWatermark: 9_000,
    committedSnapshotPages: 11,
    cursor: resumeCursor,
  })
  expect(gateway.snapshotCalls).toBe(11)
  expect(yields).toBe(1)
})

it('atomically swaps a terminal snapshot while preserving outbox and quarantine', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'snapshot-reset.db' })
  await repository.initialize(OWNER)
  const local: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000009001', ownerId: OWNER,
    entity: 'client', entityId: 'local-client', kind: 'create', baseVersion: null,
    payload: {
      id: 'local-client', ownerId: OWNER, version: 1,
      createdAt: '2026-08-07T10:00:00.000Z', updatedAt: '2026-08-07T10:00:00.000Z',
      syncState: 'pending', name: 'Unsynced local client',
    },
    createdAt: '2026-08-07T10:00:00.000Z', attempts: 0,
  }
  const poison: MutationEnvelope = {
    ...local,
    id: '00000000-0000-4000-8000-000000009002',
    entityId: 'poison-client',
    payload: { ...local.payload as object, id: 'poison-client', name: 'Needs repair' },
  }
  await repository.transactLocalMutation(local)
  await repository.transactLocalMutation(poison)
  await repository.quarantineMutation(OWNER, poison.id, 'validation')

  await expect(repository.beginSnapshotReset(OWNER, 9_000)).resolves.toBeNull()
  await repository.commitSnapshotPage(
    OWNER,
    [{
      ownerId: OWNER,
      entity: 'client',
      entityId: 'remote-client',
      payload: {
        id: 'remote-client', ownerId: OWNER, version: 4,
        createdAt: '2026-08-07T09:00:00.000Z', updatedAt: '2026-08-07T12:00:00.000Z',
        syncState: 'current', name: 'Canonical remote client',
      },
      version: 4,
      updatedAt: '2026-08-07T12:00:00.000Z',
      changeSource: 'sync_snapshot',
      changeSeq: 9_000,
      changeId: 0,
    }],
    null,
    9_000,
    false,
    resumeCursor,
  )

  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(resumeCursor)
  await expect(repository.get('client', 'remote-client')).resolves.toMatchObject({ version: 4 })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: local.id }),
  ])
  await expect(repository.listQuarantined(OWNER)).resolves.toEqual([
    expect.objectContaining({ mutationId: poison.id }),
  ])
})
