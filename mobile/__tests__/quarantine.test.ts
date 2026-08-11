jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import { __getRawDatabase, __resetSQLiteMock } from 'expo-sqlite'

import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'

beforeEach(() => {
  __resetSQLiteMock()
})

const clientMutation = (id: string, entityId = 'client-a') => ({
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
    syncState: 'pending' as const,
    name: entityId,
  },
  createdAt: '2026-08-03T10:00:00.000Z',
  attempts: 0,
})

it('moves the eighth failed attempt atomically into recoverable quarantine', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'quarantine-eight.db' })
  await repository.initialize('owner-a')
  const mutation = clientMutation('00000000-0000-4000-8000-000000000801')
  await repository.transactLocalMutation(mutation)

  for (let attempt = 1; attempt <= 7; attempt += 1) {
    await repository.recordMutationFailure('owner-a', mutation.id, 'transient')
    await expect(repository.listQuarantined('owner-a')).resolves.toEqual([])
  }
  await repository.recordMutationFailure('owner-a', mutation.id, 'transient')

  await expect(repository.outbox.list('owner-a')).resolves.toEqual([])
  await expect(repository.listQuarantined('owner-a')).resolves.toEqual([
    expect.objectContaining({
      mutationId: mutation.id,
      attempts: 8,
      reason: 'attempt-limit',
      payload: mutation.payload,
    }),
  ])
})

it('supports retry, supersede, export, and exact-confirmation discard without silent loss', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'quarantine-recovery.db' })
  await repository.initialize('owner-a')
  const original = clientMutation('00000000-0000-4000-8000-000000000811')
  await repository.transactLocalMutation(original)
  await repository.quarantineMutation('owner-a', original.id, 'validation')

  const exported = await repository.exportQuarantined('owner-a', original.id)
  expect(JSON.parse(exported)).toMatchObject({ mutationId: original.id, payload: original.payload })

  await repository.retryQuarantined('owner-a', original.id)
  await expect(repository.outbox.list('owner-a')).resolves.toEqual([
    expect.objectContaining({ id: original.id, attempts: 0 }),
  ])

  await repository.quarantineMutation('owner-a', original.id, 'validation')
  const replacement = clientMutation('00000000-0000-4000-8000-000000000812', 'client-repaired')
  await repository.supersedeQuarantined('owner-a', original.id, replacement)
  await expect(repository.listQuarantined('owner-a')).resolves.toEqual([
    expect.objectContaining({ mutationId: original.id, supersededBy: replacement.id }),
  ])
  await expect(repository.outbox.list('owner-a')).resolves.toEqual([
    expect.objectContaining({ id: replacement.id }),
  ])

  await expect(repository.discardQuarantined('owner-a', original.id, 'discard' as never))
    .rejects.toThrow(/confirmation/i)
  await repository.discardQuarantined(
    'owner-a',
    original.id,
    'DISCARD UNSYNCED CHANGE',
  )
  await expect(repository.listQuarantined('owner-a')).resolves.toEqual([])
})

it('rejects a 256 KiB + 1 mutation and a 1,001st retained operation before local data changes', async () => {
  const largeRepository = new SQLiteFieldCraftRepository({ databaseName: 'payload-cap.db' })
  await largeRepository.initialize('owner-a')
  const invoice = {
    id: 'invoice-large', ownerId: 'owner-a', version: 1,
    createdAt: '2026-08-03T10:00:00.000Z', updatedAt: '2026-08-03T10:00:00.000Z',
    syncState: 'pending' as const, clientId: 'client-a', status: 'Draft' as const,
    draft: {
      clientName: 'A', jobTitle: 'Large', tradeType: 'General' as const,
      taxBasisPoints: 0, paymentTerms: 'Due on receipt' as const,
      lineItems: [{ description: 'Labor', type: 'labor' as const, quantity: 1000, unitPriceCents: 100 }],
      notes: 'x'.repeat(262_145),
    },
    subtotalCents: 100, taxCents: 0, totalCents: 100,
  }
  await expect(largeRepository.transactLocalMutation({
    id: '00000000-0000-4000-8000-000000000821', ownerId: 'owner-a',
    entity: 'invoice', entityId: invoice.id, kind: 'create', baseVersion: null,
    payload: invoice, createdAt: invoice.createdAt, attempts: 0,
  })).rejects.toThrow('MUTATION_PAYLOAD_LIMIT')
  await expect(largeRepository.get('invoice', invoice.id)).resolves.toBeNull()

  const queueRepository = new SQLiteFieldCraftRepository({ databaseName: 'queue-cap.db' })
  await queueRepository.initialize('owner-a')
  const seed = clientMutation('00000000-0000-4000-8000-000000000822')
  await queueRepository.transactLocalMutation(seed)
  const state = __getRawDatabase('queue-cap.db')
  const template = state.outbox[0]
  for (let index = 2; index <= 1_000; index += 1) {
    state.outbox.push({
      ...template,
      mutation_id: `00000000-0000-4000-9000-${String(index).padStart(12, '0')}`,
      sequence: index,
    })
  }
  const overflow = clientMutation('00000000-0000-4000-8000-000000000823', 'client-overflow')
  await expect(queueRepository.transactLocalMutation(overflow)).rejects.toThrow('OUTBOX_QUEUE_LIMIT')
  await expect(queueRepository.get('client', 'client-overflow')).resolves.toBeNull()
})

it('blocks a child while its parent is quarantined and restores parent-first retry order', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'dependency-block.db' })
  await repository.initialize('owner-a')
  const parent = clientMutation('00000000-0000-4000-8000-000000000831', 'client-parent')
  await repository.transactLocalMutation(parent)
  const child = {
    id: '00000000-0000-4000-8000-000000000832', ownerId: 'owner-a',
    entity: 'job' as const, entityId: 'job-child', kind: 'create' as const, baseVersion: null,
    payload: {
      id: 'job-child', ownerId: 'owner-a', version: 1,
      createdAt: '2026-08-03T10:00:00.000Z', updatedAt: '2026-08-03T10:00:01.000Z',
      syncState: 'pending' as const, clientId: 'client-parent', title: 'Dependent job',
      status: 'Scheduled' as const,
    },
    createdAt: '2026-08-03T10:00:01.000Z', attempts: 0,
  }
  await repository.transactLocalMutation(child)
  await repository.quarantineMutation('owner-a', parent.id, 'validation')

  await expect(repository.outbox.list('owner-a')).resolves.toEqual([])
  await repository.retryQuarantined('owner-a', parent.id)
  await expect(repository.outbox.list('owner-a')).resolves.toEqual([
    expect.objectContaining({ id: parent.id }),
    expect.objectContaining({ id: child.id }),
  ])
})
