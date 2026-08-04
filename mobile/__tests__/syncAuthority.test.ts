import {
  __getRawDatabase,
  __resetSQLiteMock,
} from 'expo-sqlite'

import type { ConflictRecord, MutationEnvelope } from '../src/domain/sync'
import {
  DataCorruptionError,
  OutboxCorruptionError,
  type CloudRowEnvelope,
  type InvoiceBundlePayload,
} from '../src/data/repository'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

const OWNER = 'owner-a'
const DATABASE = 'sync-authority.db'
const T0 = '2026-08-03T10:00:00.000100Z'
const T1 = '2026-08-03T10:00:00.000900Z'

const client = (
  id: string,
  name: string,
  version: number,
  updatedAt: string,
  syncState: 'current' | 'pending' | 'failed' | 'conflict' = 'current',
) => ({
  id,
  ownerId: OWNER,
  version,
  createdAt: '2026-08-03T09:00:00.000Z',
  updatedAt,
  syncState,
  name,
})

const positionedClient = (
  id: string,
  name: string,
  version: number,
  updatedAt: string,
  changeSeq: number,
  changeId = changeSeq + 100,
): CloudRowEnvelope => ({
  ownerId: OWNER,
  entity: 'client',
  entityId: id,
  payload: client(id, name, version, updatedAt),
  version,
  updatedAt,
  changeSource: 'sync_changes',
  changeSeq,
  changeId,
})

const positionedTombstone = (
  id: string,
  version: number,
  updatedAt: string,
  changeSeq: number,
  changeId = changeSeq + 100,
): CloudRowEnvelope => ({
  ownerId: OWNER,
  entity: 'client',
  entityId: id,
  payload: null,
  version,
  updatedAt,
  changeSource: 'sync_changes',
  changeSeq,
  changeId,
  deleted: true,
})

const mutation = (
  id: string,
  entityId: string,
  name: string,
  createdAt = '2026-08-03T09:01:00.000Z',
): MutationEnvelope => ({
  id,
  ownerId: OWNER,
  entity: 'client',
  entityId,
  kind: 'update',
  baseVersion: 1,
  payload: client(entityId, name, 1, createdAt, 'pending'),
  createdAt,
  attempts: 0,
})

const bundle = (
  label: string,
  version: number,
  updatedAt: string,
  syncState: 'current' | 'pending' = 'current',
): InvoiceBundlePayload => ({
  client: client('bundle-client', `${label} client`, version, updatedAt, syncState),
  job: {
    id: 'bundle-job', ownerId: OWNER, clientId: 'bundle-client',
    version, createdAt: '2026-08-03T09:00:00.000Z', updatedAt, syncState,
    title: `${label} job`, status: 'Invoiced',
  },
  invoice: {
    id: 'bundle-invoice', ownerId: OWNER, clientId: 'bundle-client', jobId: 'bundle-job',
    version, createdAt: '2026-08-03T09:00:00.000Z', updatedAt, syncState,
    draft: {
      clientName: `${label} client`, jobTitle: `${label} job`, tradeType: 'General',
      taxBasisPoints: 0, paymentTerms: 'Due on receipt',
      lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
    },
    subtotalCents: 100, taxCents: 0, totalCents: 100,
  },
})

const bundleRows = (
  value: InvoiceBundlePayload,
  firstSeq: number,
): CloudRowEnvelope[] => (['client', 'job', 'invoice'] as const).map((entity, index) => ({
  ownerId: OWNER,
  entity,
  entityId: value[entity].id,
  payload: value[entity],
  version: value[entity].version,
  updatedAt: value[entity].updatedAt,
  changeSource: 'sync_changes',
  changeSeq: firstSeq + index,
  changeId: 500 + firstSeq + index,
}))

const cursor = (changeSeq: number, updatedAt = T1, changeId = changeSeq + 100): string =>
  JSON.stringify({ updatedAt, changeSeq, changeId })

beforeEach(() => {
  __resetSQLiteMock()
})

it.each([
  {
    label: 'update',
    later: positionedClient('normal-client', 'Later cloud update', 3, T1, 3),
    expected: { name: 'Later cloud update', version: 3 },
  },
  {
    label: 'tombstone',
    later: positionedTombstone('normal-client', 3, T1, 3),
    expected: null,
  },
  {
    label: 'equal-time recreation after an older delete receipt',
    later: positionedClient('normal-client', 'Later recreation', 1, T0, 3, 103),
    receipt: positionedTombstone('normal-client', 2, T0, 2, 102),
    expected: { name: 'Later recreation', version: 1 },
  },
])('never lets an old ordinary receipt overwrite a later pulled $label', async ({
  later,
  receipt = positionedClient('normal-client', 'Old receipt', 2, T0, 2),
  expected,
}) => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: DATABASE })
  await repository.initialize(OWNER)
  const first = mutation('00000000-0000-4000-8000-000000000201', 'normal-client', 'Local M1')
  await repository.transactLocalMutation(first)

  await repository.commitPull(OWNER, [later], cursor(3, later.updatedAt, later.changeId), true)
  await repository.acknowledgeMutation(OWNER, first.id, [receipt])
  await repository.close()

  const reopened = new SQLiteFieldCraftRepository({ databaseName: DATABASE })
  await reopened.initialize(OWNER)
  if (expected === null) {
    await expect(reopened.get('client', 'normal-client')).resolves.toBeNull()
  } else {
    await expect(reopened.get('client', 'normal-client')).resolves.toMatchObject(expected)
  }
  expect(JSON.parse(await reopened.getSyncCursor(OWNER) ?? '{}')).toMatchObject({ changeSeq: 3 })
})

it('keeps every newer pulled bundle member after an older bundle receipt replays across restart', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'normal-bundle-authority.db' })
  await repository.initialize(OWNER)
  const local = bundle('Local M1', 1, '2026-08-03T09:01:00.000Z', 'pending')
  const first: MutationEnvelope = {
    id: '00000000-0000-4000-8000-000000000202', ownerId: OWNER,
    entity: 'invoice', entityId: local.invoice.id, kind: 'save_invoice_bundle',
    baseVersion: 1, payload: local, createdAt: local.invoice.updatedAt, attempts: 0,
  }
  await repository.transactLocalMutation(first)
  const later = bundle('Later cloud', 3, T1)
  await repository.commitPull(OWNER, bundleRows(later, 20), cursor(22), true)
  await repository.close()

  const reopened = new SQLiteFieldCraftRepository({ databaseName: 'normal-bundle-authority.db' })
  await reopened.initialize(OWNER)
  await reopened.acknowledgeMutation(OWNER, first.id, bundleRows(bundle('Old receipt', 2, T0), 10))

  await expect(reopened.get('client', later.client.id)).resolves.toMatchObject({ name: 'Later cloud client' })
  await expect(reopened.get('job', later.job.id)).resolves.toMatchObject({ title: 'Later cloud job' })
  await expect(reopened.get('invoice', later.invoice.id)).resolves.toMatchObject({ version: 3 })
})

it('rejects two different payloads claiming the same immutable feed position', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'position-equivocation.db' })
  await repository.initialize(OWNER)
  const original = positionedClient('equivocation-client', 'Original authority', 2, T0, 2, 102)
  await repository.commitPull(OWNER, [original], cursor(2, T0, 102), true)

  await expect(repository.commitPull(
    OWNER,
    [positionedClient('equivocation-client', 'Different authority', 2, T0, 2, 102)],
    cursor(2, T0, 102),
    true,
  )).rejects.toThrow(/immutable server position/i)

  await expect(repository.get('client', 'equivocation-client')).resolves.toMatchObject({
    name: 'Original authority',
  })
})

it('rejects one owner sequence claiming two different sync-change events', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'sequence-equivocation.db' })
  await repository.initialize(OWNER)
  const original = positionedClient('sequence-equivocation-client', 'Original authority', 2, T0, 2, 102)
  await repository.commitPull(OWNER, [original], cursor(2, T0, 102), true)

  await expect(repository.commitPull(
    OWNER,
    [positionedClient('sequence-equivocation-client', 'Forged later event', 3, T1, 2, 999)],
    cursor(2, T1, 999),
    true,
  )).rejects.toThrow(/owner sequence.*different sync-change events/i)

  await expect(repository.get('client', 'sequence-equivocation-client')).resolves.toMatchObject({
    name: 'Original authority',
    version: 2,
  })
})

it('classifies deterministic cloud-envelope validation failures as data corruption', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'cloud-validation-corruption.db' })
  await repository.initialize(OWNER)
  const malformed = positionedClient('malformed-client', 'Malformed', 2, T0, 2, 102)
  malformed.payload = { ...(malformed.payload as Record<string, unknown>), version: 999 }

  await expect(repository.commitPull(
    OWNER,
    [malformed],
    cursor(2, T0, 102),
    true,
  )).rejects.toBeInstanceOf(DataCorruptionError)
})

it('classifies a valid-JSON malformed durable cursor as data corruption', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'cursor-shape-corruption.db' })
  await repository.initialize(OWNER)

  await expect(repository.commitPull(OWNER, [], '{}', true)).rejects.toBeInstanceOf(
    DataCorruptionError,
  )
})

it('classifies deterministic conflict semantic failures as data corruption', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'conflict-validation-corruption.db' })
  await repository.initialize(OWNER)
  const local = bundle('Local', 1, T0, 'pending')
  const cloud = bundle('Cloud', 2, T1)
  const malformedCloud = {
    ...cloud,
    invoice: { ...cloud.invoice, totalCents: cloud.invoice.totalCents + 1 },
  }

  await expect(repository.recordMutationConflict(OWNER, {
    mutationId: '00000000-0000-4000-8000-000000000299',
    ownerId: OWNER,
    mutationKind: 'save_invoice_bundle',
    entity: 'invoice',
    entityId: local.invoice.id,
    localPayload: local,
    cloudPayload: malformedCloud,
    cloudVersion: 2,
    cloudRows: bundleRows(cloud, 10),
  })).rejects.toBeInstanceOf(DataCorruptionError)
})

it('atomically overlays every durable later intent after an ordinary pull and preserves it on reopen', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'ordinary-pull-overlay.db' })
  await repository.initialize(OWNER)
  const first = mutation('00000000-0000-4000-8000-000000000203', 'overlay-client', 'M1')
  const second = mutation(
    '00000000-0000-4000-8000-000000000204',
    'overlay-client',
    'Exact durable M2',
    '2026-08-03T09:02:00.000Z',
  )
  await repository.transactLocalMutation(first)
  await repository.transactLocalMutation(second)
  await repository.recordMutationFailure(OWNER, second.id, 'validation')

  await repository.commitPull(
    OWNER,
    [positionedClient('overlay-client', 'Pulled M1 authority', 2, T0, 2)],
    cursor(2, T0, 102),
    true,
  )
  await expect(repository.get('client', second.entityId)).resolves.toEqual(second.payload)
  await repository.close()

  const reopened = new SQLiteFieldCraftRepository({ databaseName: 'ordinary-pull-overlay.db' })
  await reopened.initialize(OWNER)
  await expect(reopened.get('client', second.entityId)).resolves.toEqual(second.payload)
})

it('keeps later current authority when Keep cloud resolves a stale generic conflict', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'stale-keep-cloud.db' })
  await repository.initialize(OWNER)
  const local = mutation('00000000-0000-4000-8000-000000000205', 'conflict-client', 'Local edit')
  await repository.transactLocalMutation(local)
  const conflictRow = positionedClient('conflict-client', 'Conflict cloud', 2, T0, 2)
  const conflict: ConflictRecord = {
    mutationId: local.id,
    ownerId: OWNER,
    mutationKind: 'update',
    entity: 'client',
    entityId: local.entityId,
    localPayload: local.payload,
    cloudPayload: conflictRow.payload,
    cloudVersion: 2,
    cloudRows: [conflictRow],
  }
  await repository.recordMutationConflict(OWNER, conflict)
  await repository.commitPull(
    OWNER,
    [positionedClient('conflict-client', 'Later while UI open', 3, T1, 3)],
    cursor(3),
    true,
  )

  await repository.resolveConflictKeepCloud(local.id)

  await expect(repository.get('client', local.entityId)).resolves.toMatchObject({
    name: 'Later while UI open', version: 3,
  })
  await expect(repository.countConflicts(OWNER)).resolves.toBe(0)
})

it('fails a pull transaction closed with the exact immutable corrupt mutation identity', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'pull-overlay-corruption.db' })
  await repository.initialize(OWNER)
  const bad = mutation('00000000-0000-4000-8000-000000000206', 'corrupt-client', 'Local intent')
  await repository.transactLocalMutation(bad)
  const raw = __getRawDatabase('pull-overlay-corruption.db')
  const stored = raw.outbox.find((row) => row.mutation_id === bad.id)!
  stored.payload_hash = '0'.repeat(64)

  await expect(repository.commitPull(
    OWNER,
    [positionedClient('corrupt-client', 'Must roll back', 2, T0, 2)],
    cursor(2, T0, 102),
    true,
  )).rejects.toEqual(expect.objectContaining<Partial<OutboxCorruptionError>>({
    name: 'OutboxCorruptionError',
    mutationId: bad.id,
  }))
  await expect(repository.getSyncCursor(OWNER)).resolves.toBeNull()
  await expect(repository.get('client', bad.entityId)).resolves.toEqual(bad.payload)
})

it.each([
  ['source only', { changeSource: 'sync_changes' }],
  ['sequence only', { changeSeq: 1 }],
  ['event ID only', { changeId: 1 }],
  ['sync source without sequence', { changeSource: 'sync_changes', changeId: 1 }],
  ['sync source with zero sequence', { changeSource: 'sync_changes', changeSeq: 0, changeId: 1 }],
  ['sync source with zero event ID', { changeSource: 'sync_changes', changeSeq: 1, changeId: 0 }],
  ['legacy source with sync sequence', { changeSource: 'legacy_receipt', changeSeq: 1, changeId: 0 }],
  ['legacy source with sync event ID', { changeSource: 'legacy_receipt', changeSeq: 0, changeId: 1 }],
] as const)('rejects malformed source/position pairing: %s', async (_label, malformed) => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: `position-${_label}.db` })
  await repository.initialize(OWNER)
  const row = {
    ...positionedClient('position-client', 'Cloud', 2, T0, 2),
    changeSource: undefined,
    changeSeq: undefined,
    changeId: undefined,
    ...malformed,
  } as CloudRowEnvelope

  await expect(repository.commitPull(OWNER, [row], cursor(2, T0, 102), true)).rejects.toThrow()
})

it('rejects a legacy receipt row at the pull boundary', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'pull-source-matrix.db' })
  await repository.initialize(OWNER)
  const row = {
    ...positionedClient('pull-source-client', 'Wrong pull source', 2, T0, 2),
    changeSource: 'legacy_receipt' as const,
    changeSeq: 0,
    changeId: 0,
  }

  await expect(repository.commitPull(
    OWNER,
    [row],
    cursor(2, T0, 102),
    true,
  )).rejects.toThrow(/pull.*sync_changes/i)
})

it('rejects snapshot authority on a present acknowledgement row', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'ack-source-matrix.db' })
  await repository.initialize(OWNER)
  const local = mutation(
    '00000000-0000-4000-8000-000000000207',
    'ack-source-client',
    'Local edit',
  )
  await repository.transactLocalMutation(local)
  const row = {
    ...positionedClient('ack-source-client', 'Forged snapshot', 2, T0, 2),
    changeSource: 'sync_snapshot' as const,
    changeSeq: 1_000_000,
    changeId: 0,
  }

  await expect(repository.acknowledgeMutation(OWNER, local.id, [row]))
    .rejects.toThrow(/snapshot|acknowledgement/i)
  await expect(repository.outbox.list(OWNER)).resolves.toHaveLength(1)
})

it('rejects snapshot authority on a present conflict row', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'conflict-source-matrix.db' })
  await repository.initialize(OWNER)
  const local = mutation(
    '00000000-0000-4000-8000-000000000208',
    'conflict-source-client',
    'Local edit',
  )
  await repository.transactLocalMutation(local)
  const row = {
    ...positionedClient('conflict-source-client', 'Forged snapshot', 2, T0, 2),
    changeSource: 'sync_snapshot' as const,
    changeSeq: 1_000_000,
    changeId: 0,
  }

  await expect(repository.recordMutationConflict(OWNER, {
    mutationId: local.id,
    ownerId: OWNER,
    mutationKind: local.kind,
    entity: local.entity,
    entityId: local.entityId,
    localPayload: local.payload,
    cloudPayload: row.payload,
    cloudVersion: row.version,
    cloudRows: [row],
  })).rejects.toThrow(/snapshot|conflict authority/i)
  await expect(repository.countConflicts(OWNER)).resolves.toBe(0)
})
