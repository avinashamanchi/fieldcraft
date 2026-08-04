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
  cloudPayload: {
    id: 'client-1',
    ownerId: 'owner-a',
    version: 4,
    createdAt: '2026-08-03T10:00:00.000Z',
    updatedAt: '2026-08-03T10:00:04.000Z',
    syncState: 'current',
    name: 'Cloud name',
    notes: 'private cloud note',
  },
  cloudVersion: 4,
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
