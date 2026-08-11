type PaymentModule = {
  calculatePaymentSummary: (
    totalCents: number,
    entries: ReadonlyArray<{
      amountCents: number
      currency: 'USD'
      status: 'Pending' | 'Succeeded' | 'Failed' | 'Partially Refunded' | 'Refunded' | 'Disputed'
      refundedCents: number
    }>,
  ) => { paidCents: number; balanceCents: number; status: string }
}

const loadPayments = (): PaymentModule | null => {
  try {
    return require('../src/domain/payments') as PaymentModule
  } catch {
    return null
  }
}

const entry = (
  amountCents: number,
  status: 'Pending' | 'Succeeded' | 'Failed' | 'Partially Refunded' | 'Refunded' | 'Disputed' = 'Succeeded',
  refundedCents = 0,
) => ({ amountCents, currency: 'USD' as const, status, refundedCents })

it('derives partial and full payment state from append-only ledger entries', () => {
  const payments = loadPayments()
  expect(payments).not.toBeNull()
  if (!payments) return

  expect(payments.calculatePaymentSummary(10_000, [entry(2_500), entry(2_500)]))
    .toEqual({ paidCents: 5_000, balanceCents: 5_000, status: 'Partially Paid' })
  expect(payments.calculatePaymentSummary(10_000, [entry(10_000)]))
    .toEqual({ paidCents: 10_000, balanceCents: 0, status: 'Paid' })
  expect(payments.calculatePaymentSummary(10_000, [entry(10_000, 'Partially Refunded', 2_000)]))
    .toEqual({ paidCents: 8_000, balanceCents: 2_000, status: 'Partially Paid' })
})

it('ignores unsettled entries and rejects invalid or overpaid ledgers', () => {
  const payments = loadPayments()
  expect(payments).not.toBeNull()
  if (!payments) return

  expect(payments.calculatePaymentSummary(10_000, [
    entry(2_500, 'Pending'),
    entry(2_500, 'Failed'),
    entry(2_500, 'Disputed'),
  ])).toEqual({ paidCents: 0, balanceCents: 10_000, status: 'Issued' })
  expect(() => payments.calculatePaymentSummary(10_000, [entry(10_001)]))
    .toThrow('PAYMENT_EXCEEDS_BALANCE')
  expect(() => payments.calculatePaymentSummary(10_000, [entry(1_000, 'Partially Refunded', 1_001)]))
    .toThrow('INVALID_REFUND_TOTAL')
  expect(() => payments.calculatePaymentSummary(10_000, [{ ...entry(1_000), currency: 'CAD' as never }]))
    .toThrow('PAYMENT_CURRENCY_MISMATCH')
})
