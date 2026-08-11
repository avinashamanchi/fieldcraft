import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'

import {
  createConflictResolutionCommands,
  type ConflictResolutionRepository,
} from '../src/data/syncCoordinator'
import ConflictScreen, { ConflictResolutionView } from '../app/conflicts/[mutationId]'
import type { ConflictRecord, MutationEnvelope } from '../src/domain/sync'

const mockGetConflict = jest.fn()
const mockKeepCloud = jest.fn()
const mockApplyMyEdit = jest.fn()

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ mutationId: '00000000-0000-4000-8000-000000000071' }),
}))
jest.mock('../src/data/SyncProvider', () => ({
  useConflictResolutionCommands: () => ({
    getConflict: mockGetConflict,
    keepCloud: mockKeepCloud,
    applyMyEdit: mockApplyMyEdit,
  }),
}))

const cloudClient = {
  id: 'client-1',
  ownerId: 'owner-a',
  version: 4,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:04.000Z',
  syncState: 'current',
  name: 'Cloud name',
  notes: 'private cloud note',
}

const positionedRow = (
  entity: 'client' | 'job' | 'invoice',
  entityId: string,
  payload: Record<string, unknown>,
  changeSeq: number,
) => ({
  ownerId: 'owner-a', entity, entityId, payload,
  version: Number(payload.version), updatedAt: String(payload.updatedAt),
  changeSource: 'sync_changes' as const, changeSeq, changeId: changeSeq,
})

const conflict: ConflictRecord = {
  mutationId: '00000000-0000-4000-8000-000000000071',
  entity: 'client',
  entityId: 'client-1',
  localPayload: {
    id: 'client-1',
    ownerId: 'owner-a',
    version: 2,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:02.000Z',
    syncState: 'conflict',
    name: 'My local name',
    notes: 'private local note',
  },
  cloudPayload: cloudClient,
  cloudVersion: 4,
  cloudRows: [positionedRow('client', 'client-1', cloudClient, 1)],
}

class FakeConflictRepository implements ConflictResolutionRepository {
  stored: ConflictRecord | null = conflict
  kept: string[] = []
  replacements: { originalMutationId: string; replacement: MutationEnvelope }[] = []

  async getConflict(mutationId: string): Promise<ConflictRecord | null> {
    return this.stored?.mutationId === mutationId ? this.stored : null
  }

  async resolveConflictKeepCloud(mutationId: string): Promise<void> {
    this.kept.push(mutationId)
  }

  async resolveConflictWithMutation(
    originalMutationId: string,
    replacement: MutationEnvelope,
  ): Promise<void> {
    this.replacements.push({ originalMutationId, replacement })
  }
}

it('keeps the canonical cloud version through the explicit command', async () => {
  const repository = new FakeConflictRepository()
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000072',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.keepCloud(conflict.mutationId)

  expect(repository.kept).toEqual([conflict.mutationId])
  expect(repository.replacements).toEqual([])
})

it('creates a new mutation against the current cloud version without rewriting the original', async () => {
  const repository = new FakeConflictRepository()
  const original = JSON.parse(JSON.stringify(conflict))
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000072',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(conflict.mutationId)

  expect(repository.stored).toEqual(original)
  expect(repository.replacements).toEqual([
    {
      originalMutationId: conflict.mutationId,
      replacement: expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000072',
        ownerId: 'owner-a',
        entity: 'client',
        entityId: 'client-1',
        kind: 'update',
        baseVersion: 4,
        attempts: 0,
        createdAt: '2026-08-03T12:00:00.000Z',
        payload: expect.objectContaining({
          name: 'My local name',
          version: 4,
          updatedAt: '2026-08-03T12:00:00.000Z',
          syncState: 'pending',
        }),
      }),
    },
  ])
})

it('replays an offline delete conflict as a new delete against the current cloud version', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = {
    ...conflict,
    mutationKind: 'delete',
    localPayload: null,
  }
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000074',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(conflict.mutationId)

  expect(repository.replacements[0]).toEqual({
    originalMutationId: conflict.mutationId,
    replacement: expect.objectContaining({
      id: '00000000-0000-4000-8000-000000000074',
      kind: 'delete',
      baseVersion: 4,
      payload: null,
    }),
  })
})

it('treats an already-deleted null cloud row as keep-cloud instead of issuing an invalid delete', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = {
    ...conflict,
    ownerId: 'owner-a',
    mutationKind: 'delete',
    localPayload: null,
    cloudPayload: null,
    cloudVersion: 0,
  }
  const commands = createConflictResolutionCommands(repository)

  await commands.applyMyEdit(conflict.mutationId)

  expect(repository.kept).toEqual([conflict.mutationId])
  expect(repository.replacements).toEqual([])
})

it('resolves a create collision as an update against the row that now exists in SQLite', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = { ...conflict, mutationKind: 'create' }
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000075',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(conflict.mutationId)

  expect(repository.replacements[0]).toMatchObject({
    originalMutationId: conflict.mutationId,
    replacement: {
      kind: 'update',
      baseVersion: 4,
      payload: expect.objectContaining({ version: 4, syncState: 'pending' }),
    },
  })
})

it('recreates an edited row explicitly when the remote update target was deleted', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = {
    ...conflict,
    ownerId: 'owner-a',
    mutationKind: 'update',
    cloudPayload: null,
    cloudVersion: 0,
  }
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000078',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(conflict.mutationId)

  expect(repository.replacements[0]).toMatchObject({
    originalMutationId: conflict.mutationId,
    replacement: {
      kind: 'create',
      baseVersion: null,
      payload: expect.objectContaining({ version: 0, syncState: 'pending' }),
    },
  })
})

const bundleCloudPayload = {
  client: { ...conflict.cloudPayload as object, id: 'client-1', name: 'Cloud client', version: 4 },
  job: {
    id: 'job-1', ownerId: 'owner-a', clientId: 'client-1', title: 'Cloud job', status: 'Invoiced',
    version: 5, createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:05.000Z', syncState: 'current',
  },
  invoice: {
    id: 'invoice-1', ownerId: 'owner-a', clientId: 'client-1', jobId: 'job-1',
    version: 6, createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:06.000Z', syncState: 'current',
    draft: {
      clientName: 'Cloud client', jobTitle: 'Cloud job', tradeType: 'Plumbing',
      taxBasisPoints: 0, paymentTerms: 'Net 30',
      lineItems: [{ description: 'Cloud labor', type: 'labor', quantity: 1000, unitPriceCents: 200 }],
    },
    subtotalCents: 200, taxCents: 0, totalCents: 200,
  },
}

const bundleConflict: ConflictRecord = {
  mutationId: '00000000-0000-4000-8000-000000000076',
  mutationKind: 'save_invoice_bundle',
  entity: 'invoice',
  entityId: 'invoice-1',
  cloudVersion: 6,
  localPayload: {
    client: { ...conflict.localPayload as object, id: 'client-1', name: 'My client', version: 2 },
    job: {
      id: 'job-1', ownerId: 'owner-a', clientId: 'client-1', title: 'My job', status: 'Invoiced',
      version: 2, createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'conflict',
    },
    invoice: {
      id: 'invoice-1', ownerId: 'owner-a', clientId: 'client-1', jobId: 'job-1',
      version: 2, createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'conflict',
      draft: {
        clientName: 'My client', jobTitle: 'My job', tradeType: 'Plumbing',
        taxBasisPoints: 0, paymentTerms: 'Due on receipt',
        lineItems: [{ description: 'My labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
      },
      subtotalCents: 100, taxCents: 0, totalCents: 100,
    },
  },
  cloudPayload: bundleCloudPayload,
  cloudRows: [
    positionedRow('client', 'client-1', bundleCloudPayload.client, 2),
    positionedRow('job', 'job-1', bundleCloudPayload.job, 3),
    positionedRow('invoice', 'invoice-1', bundleCloudPayload.invoice, 4),
  ],
}

it('replays a compound conflict with each entity rebased to its own cloud version', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = bundleConflict
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000077',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(bundleConflict.mutationId)

  expect(repository.replacements[0]).toMatchObject({
    replacement: {
      kind: 'save_invoice_bundle',
      baseVersion: 6,
      payload: {
        client: { name: 'My client', version: 4, syncState: 'pending' },
        job: { title: 'My job', version: 5, syncState: 'pending' },
        invoice: { version: 6, syncState: 'pending' },
      },
    },
  })
})

it('explicitly recreates deleted compound members while rebasing remaining members', async () => {
  const repository = new FakeConflictRepository()
  repository.stored = {
    ...bundleConflict,
    cloudPayload: {
      ...(bundleConflict.cloudPayload as Record<string, unknown>),
      invoice: null,
    },
    cloudVersion: 0,
  }
  const commands = createConflictResolutionCommands(repository, {
    createMutationId: () => '00000000-0000-4000-8000-000000000079',
    now: () => '2026-08-03T12:00:00.000Z',
  })

  await commands.applyMyEdit(bundleConflict.mutationId)

  expect(repository.replacements[0]).toMatchObject({
    replacement: {
      kind: 'save_invoice_bundle',
      baseVersion: 0,
      payload: {
        client: { version: 4, syncState: 'pending' },
        job: { version: 5, syncState: 'pending' },
        invoice: { version: 0, syncState: 'pending' },
      },
    },
  })
})

it('renders nested invoice and line-item fields as individual comparisons', () => {
  render(
    <ConflictResolutionView
      conflict={bundleConflict}
      onKeepCloud={async () => {}}
      onApplyMyEdit={async () => {}}
    />,
  )

  expect(screen.getByText('invoice.draft.paymentTerms')).toBeTruthy()
  expect(screen.getByText('invoice.draft.lineItems[0].description')).toBeTruthy()
  expect(screen.getByText('My labor')).toBeTruthy()
  expect(screen.getByText('Cloud labor')).toBeTruthy()
})

it('renders field-level local/cloud values and exactly the two resolution actions', () => {
  const keepCloud = jest.fn(async () => {})
  const applyMyEdit = jest.fn(async () => {})

  render(
    <ConflictResolutionView
      conflict={conflict}
      onKeepCloud={keepCloud}
      onApplyMyEdit={applyMyEdit}
    />,
  )

  expect(screen.getByText('My local name')).toBeTruthy()
  expect(screen.getByText('Cloud name')).toBeTruthy()
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual([
    'Keep cloud',
    'Apply my edit',
  ])
})

it('does not log sensitive conflict content while applying a resolution', async () => {
  const consoleMethods = [
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
  ]
  const applyMyEdit = jest.fn(async () => {})

  render(
    <ConflictResolutionView
      conflict={conflict}
      onKeepCloud={async () => {}}
      onApplyMyEdit={applyMyEdit}
    />,
  )
  fireEvent.press(screen.getByRole('button', { name: 'Apply my edit' }))
  await waitFor(() => expect(applyMyEdit).toHaveBeenCalledTimes(1))

  expect(consoleMethods.every((method) => method.mock.calls.length === 0)).toBe(true)
  for (const method of consoleMethods) method.mockRestore()
})

it('loads the conflict route by mutation UUID', async () => {
  mockGetConflict.mockResolvedValueOnce(conflict)
  render(<ConflictScreen />)

  await waitFor(() => expect(screen.getByText('Resolve conflict')).toBeTruthy())
  expect(mockGetConflict).toHaveBeenCalledWith(conflict.mutationId)
  expect(screen.getByText('My local name')).toBeTruthy()
})
