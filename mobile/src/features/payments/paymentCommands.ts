import type { Invoice, Payment, PaymentMethod } from '../../domain/entities'
import { MAX_MONEY_CENTS } from '../../domain/limits'
import type { MoneyCents } from '../../domain/money'
import { calculatePaymentSummary } from '../../domain/payments'
import type { MutationEnvelope } from '../../domain/sync'
import type { FieldCraftRepository } from '../../data/repository'
import type { PageCursor } from '../../data/pagination'

export type ManualPaymentMethod = Exclude<PaymentMethod, 'Stripe'>

export type ManualPaymentPayload = Readonly<{
  paymentId: string
  invoiceId: string
  amountCents: MoneyCents
  currency: 'USD'
  method: ManualPaymentMethod
  note?: string
  recordedAt: string
  baseVersion: number
  payment: Payment
  invoice: Invoice
}>

export const buildManualPaymentMutation = (input: Readonly<{
  ownerId: string
  invoice: Invoice
  payments: Payment[]
  amountCents: MoneyCents
  method: ManualPaymentMethod
  note?: string
  paymentId: string
  mutationId: string
  recordedAt: string
}>): MutationEnvelope => {
  if (input.invoice.ownerId !== input.ownerId || input.payments.some((payment) => (
    payment.ownerId !== input.ownerId || payment.invoiceId !== input.invoice.id
  ))) throw new Error('PAYMENT_OWNER_MISMATCH')
  if (!['Issued', 'Viewed', 'Partially Paid'].includes(input.invoice.status ?? 'Draft')) {
    throw new Error('INVALID_INVOICE_TRANSITION')
  }
  if (!['Cash', 'Check', 'Bank Transfer', 'Other'].includes(input.method)) {
    throw new Error('INVALID_MANUAL_PAYMENT_METHOD')
  }
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > MAX_MONEY_CENTS) {
    throw new Error('INVALID_PAYMENT_AMOUNT')
  }
  const note = input.note?.trim()
  if (note && (
    Array.from(note).length > 1_000 || note.includes('\u0000') ||
    /[\uD800-\uDFFF]/u.test(note.normalize('NFC').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ''))
  )) throw new Error('INVALID_PAYMENT_NOTE')
  const existingLedger = input.payments.map((payment) => ({
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status,
    refundedCents: payment.refundedCents,
  }))
  const summary = calculatePaymentSummary(input.invoice.totalCents, [
    ...existingLedger,
    { amountCents: input.amountCents, currency: 'USD', status: 'Succeeded', refundedCents: 0 },
  ])
  const payment: Payment = {
    id: input.paymentId,
    ownerId: input.ownerId,
    invoiceId: input.invoice.id,
    amountCents: input.amountCents,
    currency: 'USD',
    method: input.method,
    status: 'Succeeded',
    refundedCents: 0,
    manual: true,
    ...(note ? { note } : {}),
    recordedAt: input.recordedAt,
    version: 1,
    createdAt: input.recordedAt,
    updatedAt: input.recordedAt,
    syncState: 'pending',
  }
  const invoice: Invoice = {
    ...input.invoice,
    status: summary.status,
    version: input.invoice.version + 1,
    updatedAt: input.recordedAt,
    syncState: 'pending',
  }
  const payload: ManualPaymentPayload = {
    paymentId: input.paymentId,
    invoiceId: input.invoice.id,
    amountCents: input.amountCents,
    currency: 'USD',
    method: input.method,
    ...(note ? { note } : {}),
    recordedAt: input.recordedAt,
    baseVersion: input.invoice.version,
    payment,
    invoice,
  }
  return {
    id: input.mutationId,
    ownerId: input.ownerId,
    entity: 'payment',
    entityId: input.paymentId,
    kind: 'record_manual_payment',
    baseVersion: input.invoice.version,
    payload,
    createdAt: input.recordedAt,
    attempts: 0,
  }
}

export const listInvoicePaymentsPaged = async (
  repository: Pick<FieldCraftRepository, 'listPage'>,
  invoiceId: string,
  currentOwnerId?: () => string | null,
): Promise<Payment[]> => {
  const expectedOwner = currentOwnerId?.()
  const payments: Payment[] = []
  let after: PageCursor | null = null
  let scanned = 0
  do {
    if (currentOwnerId && currentOwnerId() !== expectedOwner) throw new Error('PAYMENT_OWNER_CHANGED')
    const page: { items: Payment[]; next: PageCursor | null } =
      await repository.listPage<Payment>('payment', { limit: 50, after })
    if (currentOwnerId && currentOwnerId() !== expectedOwner) throw new Error('PAYMENT_OWNER_CHANGED')
    scanned += page.items.length
    if (scanned > 10_000) throw new Error('PAYMENT_ENTITY_CAP_EXCEEDED')
    payments.push(...page.items.filter((payment) => payment.invoiceId === invoiceId))
    after = page.next
  } while (after !== null)
  return payments
}
