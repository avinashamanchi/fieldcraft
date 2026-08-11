import { z } from 'zod'

import { MAX_MONEY_CENTS, MAX_TAX_BASIS_POINTS } from './limits'
import type { MoneyCents } from './money'

export type JobStatus =
  | 'Scheduled'
  | 'In Progress'
  | 'Completed'
  | 'Invoiced'
  | 'Partially Paid'
  | 'Paid'
  | 'Cancelled'
export type InvoiceStatus = 'Draft' | 'Issued' | 'Viewed' | 'Partially Paid' | 'Paid' | 'Void'
export type EstimateStatus = 'Draft' | 'Issued' | 'Accepted' | 'Declined' | 'Expired' | 'Converted' | 'Void'
export type PaymentStatus = 'Pending' | 'Succeeded' | 'Failed' | 'Partially Refunded' | 'Refunded' | 'Disputed'
export type PaymentMethod = 'Stripe' | 'Cash' | 'Check' | 'Bank Transfer' | 'Other'
export type SyncState = 'current' | 'pending' | 'syncing' | 'failed' | 'conflict'
export type TradeType =
  | 'Plumbing'
  | 'Electrical'
  | 'HVAC'
  | 'Carpentry'
  | 'General'
  | 'Roofing'
  | 'Flooring'
  | 'Painting'
export type PaymentTerms = 'Due on receipt' | 'Net 14' | 'Net 30'
export type ExpenseCategory = 'Materials' | 'Fuel' | 'Equipment' | 'Subcontractor' | 'Other'

export type LineItemDraft = {
  id?: string
  description: string
  type: 'labor' | 'material'
  quantity: number
  unitPriceCents: MoneyCents
}

export type InvoiceDraft = {
  clientName: string
  jobTitle: string
  jobAddress?: string
  jobDescription?: string
  tradeType: TradeType
  taxBasisPoints: number
  paymentTerms: PaymentTerms
  lineItems: LineItemDraft[]
  notes?: string
}

export type VersionedEntity = {
  id: string
  ownerId: string
  version: number
  createdAt: string
  updatedAt: string
  syncState: SyncState
}

export type Client = VersionedEntity & {
  name: string
  phone?: string
  email?: string
  address?: string
  city?: string
  state?: string
  postalCode?: string
  notes?: string
}

export type Job = VersionedEntity & {
  clientId: string
  title: string
  status: JobStatus
  tradeType?: TradeType
  address?: string
  description?: string
  laborHoursThousandths?: number
  laborRateCents?: MoneyCents
  notes?: string
  scheduledAt?: string
  completedAt?: string
}

export type Invoice = VersionedEntity & {
  clientId: string
  jobId?: string
  draft: InvoiceDraft
  subtotalCents: MoneyCents
  taxCents: MoneyCents
  totalCents: MoneyCents
  number?: string
  status?: InvoiceStatus
  issuedAt?: string
  dueAt?: string
}

export type Estimate = VersionedEntity & {
  clientId: string
  convertedJobId?: string
  number?: string
  revision: number
  status: EstimateStatus
  title: string
  scope: string
  lineItems: LineItemDraft[]
  subtotalCents: MoneyCents
  taxBasisPoints: number
  taxCents: MoneyCents
  totalCents: MoneyCents
  expiresAt: string
  issuedAt?: string
  acceptedAt?: string
  acceptanceRecordedBy?: string
  issuedSnapshot?: unknown
  notes?: string
}

export type Payment = VersionedEntity & {
  invoiceId: string
  amountCents: MoneyCents
  currency: 'USD'
  method: PaymentMethod
  status: PaymentStatus
  refundedCents: MoneyCents
  manual: boolean
  providerPaymentIntentId?: string
  providerChargeId?: string
  providerEventAt?: string
  note?: string
  recordedAt?: string
}

export type ReminderSchedule = VersionedEntity & {
  invoiceId: string
  active: boolean
  recipientEmail: string
  hasReminderConsent: boolean
  occurrences: ('three-days-before' | 'due' | 'seven-days-overdue')[]
}

export type Expense = VersionedEntity & {
  vendor: string
  amountCents: MoneyCents
  category: ExpenseCategory
  expenseDate: string
  jobId?: string
  clientId?: string
  notes?: string
  receiptPath?: string
}

export type Service = VersionedEntity & {
  name: string
  unitPriceCents: MoneyCents
  description?: string
  estimatedHoursThousandths?: number
  category?: string
}

export type InventoryItem = VersionedEntity & {
  name: string
  unitPriceCents: MoneyCents
  quantityThousandths?: number
  unit?: string
  minStockThousandths?: number
  lastUsedAt?: string
}

// Frozen boundary contract shared with fieldcraft_has_boundary_whitespace in
// 202608070001_fieldcraft_identity_security.sql: Unicode White_Space plus the
// ECMAScript legacy U+FEFF boundary character. Length is Unicode code points,
// not UTF-16 code units.
const BOUNDARY_WHITESPACE = /^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]$/u

const hasUnpairedUtf16Surrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = value.charCodeAt(index + 1)
      if (
        index + 1 >= value.length ||
        nextCodeUnit < 0xDC00 ||
        nextCodeUnit > 0xDFFF
      ) return true
      index += 1
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true
    }
  }
  return false
}

const strictBoundaryText = (maximum: number) => z.string().superRefine((value, context) => {
  if (value.includes('\u0000') || hasUnpairedUtf16Surrogate(value)) {
    context.addIssue({
      code: 'custom',
      message: 'text must be PostgreSQL-compatible Unicode without NUL or unpaired surrogates',
    })
  }
  const codePointLength = Array.from(value).length
  if (codePointLength < 1 || codePointLength > maximum) {
    context.addIssue({
      code: 'custom',
      message: `text must contain between 1 and ${maximum} Unicode code points`,
    })
  }
  if (BOUNDARY_WHITESPACE.test(value)) {
    context.addIssue({
      code: 'custom',
      message: 'text must not contain boundary whitespace',
    })
  }
})

export const CanonicalMillisecondUtcTimestampSchema = z.string()
  .regex(/^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const match = /^(\d{4})-/.exec(value)
    const year = match ? Number(match[1]) : 0
    if (year < 1 || year > 9999) return false
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
  }, 'timestamp must be canonical millisecond UTC ISO-8601')

export const OnboardingProfileV1Schema = z.object({
  displayName: strictBoundaryText(100),
  businessName: strictBoundaryText(120),
  tradeType: z.enum([
    'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting',
  ]),
  hourlyRateCents: z.number().finite().int().min(1).max(MAX_MONEY_CENTS),
  taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
  countryCode: z.literal('US'),
  currency: z.literal('USD'),
  timeZone: strictBoundaryText(100),
  onboardingVersion: z.literal(1),
  onboardingCompletedAt: CanonicalMillisecondUtcTimestampSchema,
}).strict()

export type OnboardingProfileV1 = z.infer<typeof OnboardingProfileV1Schema>

export type UserProfile = VersionedEntity & OnboardingProfileV1 & {
  logoPath?: string
}
