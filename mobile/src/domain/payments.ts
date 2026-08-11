import { MAX_MONEY_CENTS } from './limits'
import type { MoneyCents } from './money'

export type PaymentStatus =
  | 'Pending'
  | 'Succeeded'
  | 'Failed'
  | 'Partially Refunded'
  | 'Refunded'
  | 'Disputed'

export type PaymentMethod = 'Stripe' | 'Cash' | 'Check' | 'Bank Transfer' | 'Other'

export type PaymentLedgerEntry = Readonly<{
  amountCents: MoneyCents
  currency: 'USD'
  status: PaymentStatus
  refundedCents: MoneyCents
}>

export type PaymentSummary = Readonly<{
  paidCents: MoneyCents
  balanceCents: MoneyCents
  status: 'Issued' | 'Partially Paid' | 'Paid'
}>

const requireMoney = (value: number, code: string, allowZero = true): MoneyCents => {
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(value) || value < minimum || value > MAX_MONEY_CENTS) {
    throw new RangeError(code)
  }
  return value
}

const netSettledCents = (entry: PaymentLedgerEntry): MoneyCents => {
  if (entry.currency !== 'USD') throw new Error('PAYMENT_CURRENCY_MISMATCH')
  const amount = requireMoney(entry.amountCents, 'INVALID_PAYMENT_AMOUNT', false)
  const refunded = requireMoney(entry.refundedCents, 'INVALID_REFUND_TOTAL')
  if (refunded > amount) throw new Error('INVALID_REFUND_TOTAL')

  if (entry.status === 'Partially Refunded') {
    if (refunded <= 0 || refunded >= amount) throw new Error('INVALID_REFUND_TOTAL')
    return amount - refunded
  }
  if (entry.status === 'Refunded') {
    if (refunded !== amount) throw new Error('INVALID_REFUND_TOTAL')
    return 0
  }
  if (entry.status === 'Succeeded') {
    if (refunded !== 0) throw new Error('INVALID_REFUND_TOTAL')
    return amount
  }
  if (refunded !== 0) throw new Error('INVALID_REFUND_TOTAL')
  return 0
}

export const calculatePaymentSummary = (
  totalCents: MoneyCents,
  entries: readonly PaymentLedgerEntry[],
): PaymentSummary => {
  const total = requireMoney(totalCents, 'INVALID_INVOICE_TOTAL')
  let paidCents = 0
  for (const entry of entries) {
    paidCents += netSettledCents(entry)
    if (!Number.isSafeInteger(paidCents) || paidCents > total) {
      throw new Error('PAYMENT_EXCEEDS_BALANCE')
    }
  }

  const balanceCents = total - paidCents
  return Object.freeze({
    paidCents,
    balanceCents,
    status: paidCents === 0 ? 'Issued' : balanceCents === 0 ? 'Paid' : 'Partially Paid',
  })
}
