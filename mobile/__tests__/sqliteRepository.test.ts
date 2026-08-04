jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
  __failNextOutboxAcknowledge,
  __failNextOutboxInsert,
  __failNextMigration,
  __getRawDatabase,
  __pauseNextOutboxInsert,
  __resetSQLiteMock,
} from 'expo-sqlite'

import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

const OWNER = 'owner-a'
const MUTATION_ONE = '00000000-0000-4000-8000-000000000001'
const MUTATION_TWO = '00000000-0000-4000-8000-000000000002'
const cursor = (changeSeq: number) => JSON.stringify({
  updatedAt: `2026-08-03T10:00:${String(changeSeq).padStart(2, '0')}.000Z`,
  changeSeq,
  changeId: changeSeq,
})

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

const conflictCloudRow = (
  payload: Record<string, unknown> | null,
  options: { entity?: 'client' | 'job' | 'invoice'; entityId?: string; changeSeq?: number; changeId?: number } = {},
) => ({
  ownerId: OWNER,
  entity: options.entity ?? 'client',
  entityId: options.entityId ?? String(payload?.id ?? 'client-1'),
  payload,
  version: Number(payload?.version ?? 0),
  deleted: payload === null,
  updatedAt: String(payload?.updatedAt ?? '2026-08-03T10:00:00.000Z'),
  changeSource: payload === null ? 'sync_snapshot' as const : 'sync_changes' as const,
  changeSeq: options.changeSeq ?? 1,
  changeId: payload === null ? 0 : options.changeId ?? 1,
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

const invoiceBundle = () => ({
  client: client(),
  job: {
    id: 'job-1',
    ownerId: OWNER,
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending',
    clientId: 'client-1',
    title: 'Replace valve',
    status: 'Invoiced',
  },
  invoice: {
    id: 'invoice-1',
    ownerId: OWNER,
    version: 1,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending',
    clientId: 'client-1',
    jobId: 'job-1',
    draft: {
      clientName: 'Jordan Lee',
      jobTitle: 'Replace valve',
      tradeType: 'Plumbing',
      taxBasisPoints: 825,
      paymentTerms: 'Net 30',
      lineItems: [
        {
          description: 'Labor',
          type: 'labor',
          quantity: 1500,
          unitPriceCents: 10000,
        },
      ],
    },
    subtotalCents: 15000,
    taxCents: 1238,
    totalCents: 16238,
  },
})

const bundleMutation = (overrides: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000020',
  ownerId: OWNER,
  entity: 'invoice' as const,
  entityId: 'invoice-1',
  kind: 'save_invoice_bundle' as const,
  baseVersion: null,
  payload: invoiceBundle(),
  createdAt: '2026-08-03T10:00:01.000Z',
  attempts: 0,
  ...overrides,
})

beforeEach(() => {
  __resetSQLiteMock()
})

it('applies schema version 4 with every required table', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'migration.db' })

  await repository.initialize(OWNER)

  const raw = __getRawDatabase('migration.db')
  expect(raw.userVersion).toBe(4)
  expect([...raw.tables].sort()).toEqual([
    'conflicts',
    'metadata',
    'outbox',
    'records',
    'sync_bootstrap_records',
    'sync_cursors',
    'sync_server_authority',
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

it('atomically applies canonical rows before completing an acknowledged mutation', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'acknowledge.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())

  await repository.acknowledgeMutation(OWNER, MUTATION_ONE, [{
    ownerId: OWNER,
    entity: 'client',
    entityId: 'client-1',
    payload: client({ version: 2, updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'current' }),
    version: 2,
    updatedAt: '2026-08-03T10:00:02.000Z',
    changeSource: 'sync_changes',
    changeSeq: 2,
    changeId: 2,
  }])

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({
    version: 2,
    syncState: 'current',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  expect(__getRawDatabase('acknowledge.db').outbox).toEqual([
    expect.objectContaining({ mutation_id: MUTATION_ONE, state: 'complete' }),
  ])
})

it('rolls back canonical rows when durable acknowledgement fails', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'acknowledge-rollback.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())
  __failNextOutboxAcknowledge('acknowledge-rollback.db')

  await expect(repository.acknowledgeMutation(OWNER, MUTATION_ONE, [{
    ownerId: OWNER,
    entity: 'client',
    entityId: 'client-1',
    payload: client({ version: 2, updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'current' }),
    version: 2,
    updatedAt: '2026-08-03T10:00:02.000Z',
    changeSource: 'sync_changes',
    changeSeq: 2,
    changeId: 2,
  }])).rejects.toThrow(/acknowledgement/i)

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({
    version: 1,
    syncState: 'pending',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toHaveLength(1)
})

it('commits pulled rows and the global cursor in one owner-scoped transaction', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'pull-cursor.db' })
  await repository.initialize(OWNER)

  await repository.commitPull(OWNER, [{
    ownerId: OWNER,
    entity: 'client',
    entityId: 'client-1',
    payload: client({ version: 2, updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'current' }),
    version: 2,
    updatedAt: '2026-08-03T10:00:02.000Z',
    changeSource: 'sync_changes',
    changeSeq: 2,
    changeId: 2,
  }], cursor(2))

  await expect(repository.getSyncCursor(OWNER)).resolves.toBe(cursor(2))
  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({ version: 2 })
})

it('retains every failed FIFO head visibly while only retryable failures can be sent', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'failure-state.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())

  await repository.recordMutationFailure(OWNER, MUTATION_ONE, 'transient')
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_ONE, attempts: 1 }),
  ])

  await repository.recordMutationFailure(OWNER, MUTATION_ONE, 'validation')
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({
      id: MUTATION_ONE,
      attempts: 2,
      failureReason: 'validation',
    }),
  ])
  expect(__getRawDatabase('failure-state.db').outbox).toEqual([
    expect.objectContaining({
      mutation_id: MUTATION_ONE,
      attempts: 2,
      state: 'failed',
      last_error: 'validation',
    }),
  ])
})

it('keeps a permanent failed head ahead of later pending work in durable FIFO order', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'permanent-fifo.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())
  await repository.transactLocalMutation(mutation({
    id: MUTATION_TWO,
    entityId: 'client-2',
    payload: client({ id: 'client-2' }),
  }))
  await repository.recordMutationFailure(OWNER, MUTATION_ONE, 'invalid-response')

  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_ONE, failureReason: 'invalid-response' }),
    expect.objectContaining({ id: MUTATION_TWO }),
  ])
  expect((await repository.outbox.list(OWNER))[1]).not.toHaveProperty('failureReason')
})

it('durably marks initial cloud hydration only on a complete pull and clears it with the owner', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'cloud-hydration.db' })
  await repository.initialize(OWNER)

  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
  await repository.commitPull(OWNER, [], cursor(1), false)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)

  const completed = repository.waitForInitialPull(OWNER)
  await repository.commitPull(OWNER, [], cursor(2), true)
  await expect(completed).resolves.toBeUndefined()
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(true)

  await repository.clearOwner(OWNER)
  await repository.initialize(OWNER)
  await expect(repository.hasCompletedInitialPull(OWNER)).resolves.toBe(false)
})

it('emits sync wakeups only for committed local mutations, not pulls or retry bookkeeping', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'local-mutation-events.db' })
  await repository.initialize(OWNER)
  const listener = jest.fn()
  const unsubscribe = repository.subscribeToLocalMutations(listener)

  await repository.transactLocalMutation(mutation())
  expect(listener).toHaveBeenCalledTimes(1)
  expect(listener).toHaveBeenLastCalledWith(OWNER)

  await repository.commitPull(OWNER, [], cursor(1), true)
  await repository.recordMutationFailure(OWNER, MUTATION_ONE, 'transient')
  expect(listener).toHaveBeenCalledTimes(1)

  unsubscribe()
  await repository.transactLocalMutation(mutation({
    id: MUTATION_TWO,
    entityId: 'client-2',
    payload: client({ id: 'client-2' }),
  }))
  expect(listener).toHaveBeenCalledTimes(1)
})

it('atomically records a conflict and removes it from the sendable FIFO', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'record-conflict.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation({
    kind: 'update',
    baseVersion: 1,
    payload: client({ version: 1 }),
  }))
  const record = {
    mutationId: MUTATION_ONE,
    mutationKind: 'update' as const,
    entity: 'client' as const,
    entityId: 'client-1',
    localPayload: client({ version: 1, syncState: 'conflict' }),
    cloudPayload: client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud',
    }),
    cloudVersion: 3,
    cloudRows: [conflictCloudRow(client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud',
    }))],
  }

  await repository.recordMutationConflict(OWNER, record)

  await expect(repository.outbox.list(OWNER)).resolves.toEqual([])
  await expect(repository.countConflicts(OWNER)).resolves.toBe(1)
  await expect(repository.getConflict(MUTATION_ONE)).resolves.toEqual({ ...record, ownerId: OWNER })
  expect(__getRawDatabase('record-conflict.db').outbox[0]).toMatchObject({ state: 'conflict' })
})

it('rejects a bundle conflict whose positioned authority duplicates one member', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'duplicate-bundle-authority.db' })
  await repository.initialize(OWNER)
  const local = invoiceBundle()
  await repository.transactLocalMutation(bundleMutation({ payload: local }))
  const cloud = {
    client: { ...local.client, version: 4, syncState: 'current' as const },
    job: { ...local.job, version: 5, syncState: 'current' as const },
    invoice: { ...local.invoice, version: 6, syncState: 'current' as const },
  }
  const clientAuthority = conflictCloudRow(cloud.client, { changeSeq: 10, changeId: 10 })

  await expect(repository.recordMutationConflict(OWNER, {
    mutationId: bundleMutation().id,
    mutationKind: 'save_invoice_bundle',
    entity: 'invoice',
    entityId: local.invoice.id,
    localPayload: local,
    cloudPayload: cloud,
    cloudVersion: cloud.invoice.version,
    cloudRows: [
      clientAuthority,
      { ...clientAuthority, changeSeq: 11, changeId: 11 },
      { ...clientAuthority, changeSeq: 12, changeId: 12 },
    ],
  })).rejects.toMatchObject({
    name: 'DataCorruptionError',
    message: 'Conflict authority response is invalid',
  })

  await expect(repository.countConflicts(OWNER)).resolves.toBe(0)
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: bundleMutation().id }),
  ])
})

it('keeps cloud by applying the preserved canonical value before resolving the original', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'keep-cloud.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation({ kind: 'update', baseVersion: 1 }))
  await repository.recordMutationConflict(OWNER, {
    mutationId: MUTATION_ONE,
    mutationKind: 'update',
    entity: 'client',
    entityId: 'client-1',
    localPayload: client({ syncState: 'conflict' }),
    cloudPayload: client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud wins',
    }),
    cloudVersion: 3,
    cloudRows: [conflictCloudRow(client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud wins',
    }))],
  })

  await repository.resolveConflictKeepCloud(MUTATION_ONE)

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({
    name: 'Cloud wins', version: 3, syncState: 'current',
  })
  await expect(repository.getConflict(MUTATION_ONE)).resolves.toBeNull()
  expect(__getRawDatabase('keep-cloud.db').outbox[0]).toMatchObject({ state: 'complete' })
})

it('preserves the original outbox record while atomically creating a new current-version edit', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'apply-edit.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation({ kind: 'update', baseVersion: 1 }))
  await repository.recordMutationConflict(OWNER, {
    mutationId: MUTATION_ONE,
    mutationKind: 'update',
    entity: 'client',
    entityId: 'client-1',
    localPayload: client({ syncState: 'conflict', name: 'My edit' }),
    cloudPayload: client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud',
    }),
    cloudVersion: 3,
    cloudRows: [conflictCloudRow(client({
      version: 3,
      updatedAt: '2026-08-03T10:00:03.000Z',
      syncState: 'current',
      name: 'Cloud',
    }))],
  })
  const replacement = mutation({
    id: MUTATION_TWO,
    kind: 'update',
    baseVersion: 3,
    createdAt: '2026-08-03T10:00:04.000Z',
    payload: client({
      version: 3,
      updatedAt: '2026-08-03T10:00:04.000Z',
      syncState: 'pending',
      name: 'My edit',
    }),
  })

  await repository.resolveConflictWithMutation(MUTATION_ONE, replacement)

  expect(__getRawDatabase('apply-edit.db').outbox).toEqual([
    expect.objectContaining({ mutation_id: MUTATION_ONE, state: 'complete' }),
    expect.objectContaining({ mutation_id: MUTATION_TWO, state: 'pending' }),
  ])
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_TWO, baseVersion: 3 }),
  ])
  await expect(repository.getConflict(MUTATION_ONE)).resolves.toBeNull()
})

it('rebases a create collision as an update against the canonical SQLite cloud row', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'create-conflict.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())
  await repository.recordMutationConflict(OWNER, {
    mutationId: MUTATION_ONE,
    mutationKind: 'create',
    entity: 'client',
    entityId: 'client-1',
    localPayload: client({ syncState: 'conflict', name: 'My create' }),
    cloudPayload: client({
      version: 4,
      updatedAt: '2026-08-03T10:00:04.000Z',
      syncState: 'current',
      name: 'Cloud row',
    }),
    cloudVersion: 4,
    cloudRows: [conflictCloudRow(client({
      version: 4,
      updatedAt: '2026-08-03T10:00:04.000Z',
      syncState: 'current',
      name: 'Cloud row',
    }))],
  })

  await repository.resolveConflictWithMutation(MUTATION_ONE, mutation({
    id: MUTATION_TWO,
    kind: 'update',
    baseVersion: 4,
    payload: client({
      version: 4,
      updatedAt: '2026-08-03T10:00:05.000Z',
      syncState: 'pending',
      name: 'My create',
    }),
  }))

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({
    name: 'My create',
    version: 4,
    syncState: 'pending',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_TWO, kind: 'update', baseVersion: 4 }),
  ])
})

it('atomically replaces an update-versus-deletion conflict with an explicit create', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'recreate-deleted.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation({
    kind: 'update',
    baseVersion: 1,
    payload: client({ version: 1 }),
  }))
  await repository.recordMutationConflict(OWNER, {
    mutationId: MUTATION_ONE,
    mutationKind: 'update',
    entity: 'client',
    entityId: 'client-1',
    localPayload: client({ version: 1, syncState: 'conflict', name: 'My edit' }),
    cloudPayload: null,
    cloudVersion: 0,
    cloudRows: [conflictCloudRow(null)],
  })

  await repository.resolveConflictWithMutation(MUTATION_ONE, mutation({
    id: MUTATION_TWO,
    kind: 'create',
    baseVersion: null,
    payload: client({ version: 0, syncState: 'pending', name: 'My edit' }),
  }))

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({
    name: 'My edit', version: 0, syncState: 'pending',
  })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_TWO, kind: 'create', baseVersion: null }),
  ])
  expect(__getRawDatabase('recreate-deleted.db').outbox).toEqual([
    expect.objectContaining({ mutation_id: MUTATION_ONE, state: 'complete' }),
    expect.objectContaining({ mutation_id: MUTATION_TWO, state: 'pending' }),
  ])
})

it('atomically rebases a compound edit with a remotely deleted invoice for explicit recreation', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'recreate-bundle-member.db' })
  await repository.initialize(OWNER)
  const original = invoiceBundle()
  original.client.version = 2
  original.job.version = 2
  original.invoice.version = 2
  await repository.transactLocalMutation(bundleMutation({ payload: original }))
  const cloudClient = client({ version: 4, syncState: 'current', name: 'Cloud client' })
  const cloudJob = {
    ...original.job,
    version: 5,
    updatedAt: '2026-08-03T10:00:05.000Z',
    syncState: 'current' as const,
    title: 'Cloud job',
  }
  await repository.recordMutationConflict(OWNER, {
    mutationId: '00000000-0000-4000-8000-000000000020',
    mutationKind: 'save_invoice_bundle',
    entity: 'invoice',
    entityId: 'invoice-1',
    localPayload: original,
    cloudPayload: { client: cloudClient, job: cloudJob, invoice: null },
    cloudVersion: 0,
    cloudRows: [
      conflictCloudRow(cloudClient, { changeSeq: 1, changeId: 1 }),
      conflictCloudRow(cloudJob, { entity: 'job', entityId: 'job-1', changeSeq: 2, changeId: 2 }),
      conflictCloudRow(null, { entity: 'invoice', entityId: 'invoice-1', changeSeq: 2 }),
    ],
  })
  const replacement = invoiceBundle()
  replacement.client = { ...replacement.client, version: 4, syncState: 'pending' }
  replacement.job = { ...replacement.job, version: 5, syncState: 'pending' }
  replacement.invoice = { ...replacement.invoice, version: 0, syncState: 'pending' }

  await repository.resolveConflictWithMutation(
    '00000000-0000-4000-8000-000000000020',
    bundleMutation({
      id: '00000000-0000-4000-8000-000000000021',
      baseVersion: 0,
      payload: replacement,
    }),
  )

  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({
      id: '00000000-0000-4000-8000-000000000021',
      kind: 'save_invoice_bundle',
      payload: replacement,
    }),
  ])
  await expect(repository.get('invoice', 'invoice-1')).resolves.toMatchObject({
    version: 0,
    syncState: 'pending',
  })
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

it('treats mutable retry attempts as outside immutable duplicate content', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'attempts.db' })
  await repository.initialize(OWNER)

  await repository.transactLocalMutation(mutation())
  await repository.transactLocalMutation(mutation({ attempts: 4 }))

  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ id: MUTATION_ONE, attempts: 0 }),
  ])
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
  ).rejects.toMatchObject({
    name: 'DataCorruptionError',
    message: 'Cloud authority response is invalid',
  })

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
      cloudRows: [conflictCloudRow(client({ syncState: 'conflict' }))],
    }),
  ).rejects.toThrow()

  expect(__getRawDatabase('conflict-validation.db').conflicts).toEqual([])
})

it('atomically caches a validated client, job, and invoice bundle with one outbox envelope', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'bundle.db' })
  await repository.initialize(OWNER)

  await repository.transactLocalMutation(bundleMutation())

  await expect(repository.get('client', 'client-1')).resolves.toMatchObject({ id: 'client-1' })
  await expect(repository.get('job', 'job-1')).resolves.toMatchObject({ id: 'job-1' })
  await expect(repository.get('invoice', 'invoice-1')).resolves.toMatchObject({ id: 'invoice-1' })
  await expect(repository.outbox.list(OWNER)).resolves.toEqual([
    expect.objectContaining({ kind: 'save_invoice_bundle', payload: invoiceBundle() }),
  ])
})

it('rolls back every bundle row when its one outbox insertion fails', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'bundle-rollback.db' })
  await repository.initialize(OWNER)
  __failNextOutboxInsert('bundle-rollback.db')

  await expect(repository.transactLocalMutation(bundleMutation())).rejects.toThrow('outbox')

  expect(__getRawDatabase('bundle-rollback.db').records).toEqual([])
  expect(__getRawDatabase('bundle-rollback.db').outbox).toEqual([])
})

it('rejects invoice totals that disagree with deterministic invoice math', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'invoice-math.db' })
  await repository.initialize(OWNER)
  const payload = invoiceBundle()
  payload.invoice.totalCents += 1

  await expect(repository.transactLocalMutation(bundleMutation({ payload }))).rejects.toThrow(/total/i)
  expect(__getRawDatabase('invoice-math.db').records).toEqual([])
})

it('rejects a list row whose SQLite key disagrees with its validated payload ID', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'key-mismatch.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(mutation())
  __getRawDatabase('key-mismatch.db').records[0].entity_id = 'different-client'

  await expect(repository.list('client')).rejects.toThrow(/corrupt/i)
})

it('does not expose transaction-local cache rows before a later outbox failure rolls back', async () => {
  const writer = new SQLiteFieldCraftRepository({ databaseName: 'transaction-isolation.db' })
  const reader = new SQLiteFieldCraftRepository({ databaseName: 'transaction-isolation.db' })
  await Promise.all([writer.initialize(OWNER), reader.initialize(OWNER)])
  const paused = __pauseNextOutboxInsert('transaction-isolation.db')
  __failNextOutboxInsert('transaction-isolation.db')

  const write = writer.transactLocalMutation(mutation())
  await paused.started

  await expect(reader.list('client')).resolves.toEqual([])
  paused.release()
  await expect(write).rejects.toThrow(/outbox/i)
  await expect(reader.list('client')).resolves.toEqual([])
})

it('rejects schema-valid persisted invoice total corruption from both list and get', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'persisted-invoice-math.db' })
  await repository.initialize(OWNER)
  await repository.transactLocalMutation(bundleMutation())
  const invoiceRow = __getRawDatabase('persisted-invoice-math.db').records.find(
    (row) => row.entity === 'invoice',
  )
  if (!invoiceRow) throw new Error('invoice test fixture was not persisted')
  const persisted = JSON.parse(invoiceRow.payload_json) as Record<string, unknown>
  invoiceRow.payload_json = JSON.stringify({ ...persisted, totalCents: 16239 })

  await expect(repository.list('invoice')).rejects.toThrow(/corrupt/i)
  await expect(repository.get('invoice', 'invoice-1')).rejects.toThrow(/corrupt/i)
})

it('drains a failing accepted write before final owner deactivation and closes each connection once', async () => {
  const writer = new SQLiteFieldCraftRepository({ databaseName: 'failed-write-close.db' })
  const peer = new SQLiteFieldCraftRepository({ databaseName: 'failed-write-close.db' })
  await Promise.all([writer.initialize(OWNER), peer.initialize(OWNER)])
  const paused = __pauseNextOutboxInsert('failed-write-close.db')
  __failNextOutboxInsert('failed-write-close.db')

  const write = writer.transactLocalMutation(mutation())
  await paused.started
  const writerClose = writer.close()
  await peer.close()
  const ownerWhileWriteWasPending = writer.ownerBoundary.getSnapshot().ownerId
  paused.release()

  await expect(write).rejects.toThrow(/outbox/i)
  await expect(writerClose).resolves.toBeUndefined()

  const raw = __getRawDatabase('failed-write-close.db')
  expect(ownerWhileWriteWasPending).toBe(OWNER)
  expect(writer.ownerBoundary.getSnapshot().ownerId).toBeNull()
  expect(raw.records).toEqual([])
  expect(raw.outbox).toEqual([])
  expect(raw.closeCount).toBe(2)

  await Promise.all([writer.close(), peer.close()])
  expect(raw.closeCount).toBe(2)
})
