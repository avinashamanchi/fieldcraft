type EstimateModule = {
  assertEstimateTransition: (from: string, to: string) => void
  issueEstimate: (draft: unknown, options: {
    number: string
    issuedAt: string
    expiresAt: string
    revision: number
  }) => {
    status: string
    number: string
    revision: number
    issuedSnapshot: { lineItems: Array<{ description: string }>; totalCents: number }
  }
}

const loadEstimates = (): EstimateModule | null => {
  try {
    return require('../src/domain/estimates') as EstimateModule
  } catch {
    return null
  }
}

const draft = () => ({
  clientId: '11000000-0000-4000-8000-000000000001',
  title: 'Replace valve',
  scope: 'Replace the failed shutoff valve.',
  taxBasisPoints: 825,
  lineItems: [{ description: 'Labor', type: 'labor', quantity: 1_000, unitPriceCents: 10_000 }],
  notes: 'Synthetic estimate fixture.',
})

it('allows only the reviewed estimate lifecycle transitions', () => {
  const estimates = loadEstimates()
  expect(estimates).not.toBeNull()
  if (!estimates) return

  expect(() => estimates.assertEstimateTransition('Draft', 'Issued')).not.toThrow()
  expect(() => estimates.assertEstimateTransition('Issued', 'Accepted')).not.toThrow()
  expect(() => estimates.assertEstimateTransition('Accepted', 'Converted')).not.toThrow()
  expect(() => estimates.assertEstimateTransition('Draft', 'Converted')).toThrow('INVALID_ESTIMATE_TRANSITION')
  expect(() => estimates.assertEstimateTransition('Converted', 'Accepted')).toThrow('INVALID_ESTIMATE_TRANSITION')
})

it('issues a revision with a detached immutable calculation snapshot', () => {
  const estimates = loadEstimates()
  expect(estimates).not.toBeNull()
  if (!estimates) return

  const mutableDraft = draft()
  const issued = estimates.issueEstimate(mutableDraft, {
    number: 'EST-1001',
    issuedAt: '2026-08-10T20:00:00.000Z',
    expiresAt: '2026-09-09T20:00:00.000Z',
    revision: 1,
  })
  mutableDraft.lineItems[0].description = 'Changed later'

  expect(issued).toMatchObject({ status: 'Issued', number: 'EST-1001', revision: 1 })
  expect(issued.issuedSnapshot.lineItems[0]?.description).toBe('Labor')
  expect(issued.issuedSnapshot.totalCents).toBe(10_825)
  expect(Object.isFrozen(issued.issuedSnapshot)).toBe(true)
  expect(Object.isFrozen(issued.issuedSnapshot.lineItems)).toBe(true)
})
