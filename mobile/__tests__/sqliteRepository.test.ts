jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import {
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
