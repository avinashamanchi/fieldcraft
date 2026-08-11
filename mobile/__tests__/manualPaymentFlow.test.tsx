jest.mock('expo-sqlite')
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => `sha256:${value}`,
}))

import { __resetSQLiteMock } from 'expo-sqlite'
import type { Invoice, Payment } from '../src/domain/entities'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import { buildManualPaymentMutation } from '../src/features/payments/paymentCommands'

const ownerId = '10000000-0000-4000-8000-000000000001'
const invoice: Invoice = {
  id: '20000000-0000-4000-8000-000000000001', ownerId,
  clientId: '30000000-0000-4000-8000-000000000001',
  draft: {
    clientName: 'Mina', jobTitle: 'Valve', tradeType: 'Plumbing', taxBasisPoints: 0,
    paymentTerms: 'Due on receipt',
    lineItems: [{ description: 'Labor', type: 'labor', quantity: 1_000, unitPriceCents: 10_000 }],
  },
  subtotalCents: 10_000, taxCents: 0, totalCents: 10_000, status: 'Issued',
  version: 3, createdAt: '2026-08-10T20:00:00.000Z', updatedAt: '2026-08-10T20:00:00.000Z', syncState: 'current',
}

beforeEach(() => __resetSQLiteMock())

const build = (amountCents: number, payments: Payment[] = [], suffix = '1') => buildManualPaymentMutation({
  ownerId, invoice, payments, amountCents, method: 'Cash', note: 'Receipt confirmed',
  paymentId: `40000000-0000-4000-8000-00000000000${suffix}`,
  mutationId: `50000000-0000-4000-8000-00000000000${suffix}`,
  recordedAt: '2026-08-11T20:00:00.000Z',
})

it('atomically materializes the payment and revised invoice offline', async () => {
  const repository = new SQLiteFieldCraftRepository({ databaseName: 'manual-payment.db' })
  await repository.initialize(ownerId)
  await repository.transactLocalMutation({
    id: '50000000-0000-4000-8000-000000000021', ownerId,
    entity: 'invoice', entityId: invoice.id, kind: 'create', baseVersion: null,
    payload: invoice, createdAt: invoice.createdAt, attempts: 0,
  })
  const mutation = build(2_500, [], '2')
  await repository.transactLocalMutation(mutation)
  await expect(repository.get('payment', mutation.entityId)).resolves.toMatchObject({ amountCents: 2_500, status: 'Succeeded' })
  await expect(repository.get('invoice', invoice.id)).resolves.toMatchObject({ status: 'Partially Paid', version: 4 })
})

it('records a partial manual payment from an append-only ledger', () => {
  const mutation = build(2_500)
  expect(mutation).toMatchObject({
    entity: 'payment', kind: 'record_manual_payment', baseVersion: 3,
    payload: {
      amountCents: 2_500, currency: 'USD', method: 'Cash', baseVersion: 3,
      payment: { amountCents: 2_500, status: 'Succeeded', manual: true },
      invoice: { status: 'Partially Paid' },
    },
  })
})

it('allows exact settlement and rejects overpayment or Stripe as a manual method', () => {
  const prior = (build(2_500).payload as { payment: Payment }).payment
  expect(buildManualPaymentMutation({
    ownerId, invoice, payments: [prior], amountCents: 7_500, method: 'Check',
    paymentId: '40000000-0000-4000-8000-000000000002',
    mutationId: '50000000-0000-4000-8000-000000000002',
    recordedAt: '2026-08-12T20:00:00.000Z',
  }).payload).toMatchObject({ invoice: { status: 'Paid' } })
  expect(() => build(10_001)).toThrow('PAYMENT_EXCEEDS_BALANCE')
  expect(() => buildManualPaymentMutation({
    ownerId, invoice, payments: [], amountCents: 1_000, method: 'Stripe' as never,
    paymentId: '40000000-0000-4000-8000-000000000003',
    mutationId: '50000000-0000-4000-8000-000000000003',
    recordedAt: '2026-08-12T20:00:00.000Z',
  })).toThrow('INVALID_MANUAL_PAYMENT_METHOD')
})
