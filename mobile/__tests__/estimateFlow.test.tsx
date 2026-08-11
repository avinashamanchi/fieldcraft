jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
  randomUUID: jest.fn()
    .mockReturnValueOnce('60000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('60000000-0000-4000-8000-000000000002'),
}))
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }))

import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { __resetSQLiteMock } from 'expo-sqlite'
import type { Client, Estimate } from '../src/domain/entities'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import {
  buildAcceptEstimateMutation,
  buildConvertEstimateMutation,
  buildEstimateMutation,
  buildIssueEstimateMutation,
} from '../src/features/estimates/estimateCommands'
import { EstimateEditor } from '../src/features/estimates/EstimateEditor'

const ownerId = '10000000-0000-4000-8000-000000000001'
const clientId = '20000000-0000-4000-8000-000000000001'
const estimateId = '30000000-0000-4000-8000-000000000001'
const jobId = '40000000-0000-4000-8000-000000000001'
const now = '2026-08-10T20:00:00.000Z'

beforeEach(() => __resetSQLiteMock())

const draftMutation = () => buildEstimateMutation({
  ownerId,
  estimateId,
  mutationId: '50000000-0000-4000-8000-000000000001',
  now,
  draft: {
    clientId,
    title: 'Replace valve',
    scope: 'Remove the failed valve and install a new one.',
    lineItems: [{ description: 'Labor', type: 'labor', quantity: 1_000, unitPriceCents: 10_000 }],
    taxBasisPoints: 825,
    expiresAt: '2026-09-09T20:00:00.000Z',
    notes: 'Owner-reviewed scope.',
  },
})

it('builds a deterministic draft and immutable issued snapshot without changing identity', () => {
  const draft = draftMutation()
  expect(draft).toMatchObject({
    entity: 'estimate', kind: 'save_estimate', entityId: estimateId, baseVersion: null,
    payload: { id: estimateId, ownerId, status: 'Draft', version: 0, totalCents: 10_825 },
  })

  const issued = buildIssueEstimateMutation({
    estimate: (draft.payload as { localEstimate: Estimate }).localEstimate,
    mutationId: '50000000-0000-4000-8000-000000000002',
    issuedAt: '2026-08-11T20:00:00.000Z',
  })
  expect(issued).toMatchObject({
    entityId: estimateId, kind: 'save_estimate', baseVersion: 1,
    payload: { status: 'Issued', issuedAt: '2026-08-11T20:00:00.000Z' },
  })
  expect((issued.payload as Estimate).issuedSnapshot).toMatchObject({ totalCents: 10_825 })
})

it('records owner acceptance and creates one atomic local conversion intent', () => {
  const issuedMutation = buildIssueEstimateMutation({
    estimate: (draftMutation().payload as { localEstimate: Estimate }).localEstimate,
    mutationId: '50000000-0000-4000-8000-000000000002',
    issuedAt: '2026-08-11T20:00:00.000Z',
  })
  const issued = (issuedMutation.payload as { localEstimate: Estimate }).localEstimate
  const accepted = buildAcceptEstimateMutation({
    estimate: issued,
    mutationId: '50000000-0000-4000-8000-000000000003',
    acceptedAt: '2026-08-12T20:00:00.000Z',
  })
  expect(accepted.payload).toMatchObject({
    status: 'Accepted', acceptanceRecordedBy: ownerId,
    acceptedAt: '2026-08-12T20:00:00.000Z',
  })

  const conversion = buildConvertEstimateMutation({
    estimate: (accepted.payload as { localEstimate: Estimate }).localEstimate,
    mutationId: '50000000-0000-4000-8000-000000000004',
    jobId,
    now: '2026-08-13T20:00:00.000Z',
  })
  expect(conversion).toMatchObject({
    entity: 'estimate', entityId: estimateId, kind: 'convert_estimate',
    payload: {
      estimateId, jobId, baseVersion: 3,
      estimate: { status: 'Converted', convertedJobId: jobId },
      job: { id: jobId, ownerId, clientId, status: 'In Progress' },
    },
  })
  expect(() => buildConvertEstimateMutation({
    estimate: (conversion.payload as { estimate: Estimate }).estimate,
    mutationId: '50000000-0000-4000-8000-000000000005',
    jobId: '40000000-0000-4000-8000-000000000002',
    now: '2026-08-14T20:00:00.000Z',
  })).toThrow('INVALID_ESTIMATE_TRANSITION')
})

it('persists every offline lifecycle step as validated optimistic records', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'estimate-lifecycle.db' })
  await repository.initialize(ownerId)
  const draft = draftMutation()
  await repository.transactLocalMutation(draft)
  const localDraft = await repository.get<Estimate>('estimate', estimateId)
  expect(localDraft).toMatchObject({ status: 'Draft', version: 1 })

  const issued = buildIssueEstimateMutation({
    estimate: localDraft!, mutationId: '50000000-0000-4000-8000-000000000012',
    issuedAt: '2026-08-11T20:00:00.000Z',
  })
  await repository.transactLocalMutation(issued)
  const localIssued = await repository.get<Estimate>('estimate', estimateId)
  expect(localIssued).toMatchObject({ status: 'Issued', version: 2 })

  const accepted = buildAcceptEstimateMutation({
    estimate: localIssued!, mutationId: '50000000-0000-4000-8000-000000000013',
    acceptedAt: '2026-08-12T20:00:00.000Z',
  })
  await repository.transactLocalMutation(accepted)
  const localAccepted = await repository.get<Estimate>('estimate', estimateId)
  expect(localAccepted).toMatchObject({ status: 'Accepted', version: 3 })

  await repository.transactLocalMutation(buildConvertEstimateMutation({
    estimate: localAccepted!, mutationId: '50000000-0000-4000-8000-000000000014',
    jobId, now: '2026-08-13T20:00:00.000Z',
  }))
  await expect(repository.get<Estimate>('estimate', estimateId)).resolves.toMatchObject({ status: 'Converted', version: 4 })
  await expect(repository.get('job', jobId)).resolves.toMatchObject({ id: jobId, status: 'In Progress', version: 1 })
})

it('suppresses duplicate saves and retains every typed field after local failure', async () => {
  let rejectSave!: (cause: Error) => void
  const pending = new Promise<void>((_resolve, reject) => { rejectSave = reject })
  const repository = { transactLocalMutation: jest.fn(() => pending) }
  const client: Client = {
    id: clientId, ownerId, name: 'Mina', version: 1,
    createdAt: now, updatedAt: now, syncState: 'current',
  }
  render(<EstimateEditor clients={[client]} ownerId={ownerId} repository={repository as never} />)
  fireEvent.changeText(screen.getByTestId('estimate-title'), 'Typed estimate')
  fireEvent.changeText(screen.getByTestId('estimate-scope'), 'Typed scope survives a disk failure.')
  fireEvent.changeText(screen.getByTestId('estimate-line-description-0'), 'Labor')
  fireEvent.changeText(screen.getByLabelText('Unit price ($)'), '100.00')
  await act(async () => {
    fireEvent.press(screen.getByTestId('save-estimate'))
    fireEvent.press(screen.getByTestId('save-estimate'))
    await Promise.resolve()
    expect(repository.transactLocalMutation).toHaveBeenCalledTimes(1)
    rejectSave(new Error('disk busy'))
    await pending.catch(() => {})
  })
  expect(screen.getByTestId('estimate-title').props.value).toBe('Typed estimate')
  expect(screen.getByRole('alert')).toHaveTextContent('disk busy')
})
