import { z } from 'zod'

import { MAX_MONEY_CENTS, MAX_TAX_BASIS_POINTS } from './limits'
import type { MoneyCents } from './money'

export type JobStatus = 'Scheduled' | 'In Progress' | 'Invoiced' | 'Paid'
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

const strictTrimmedText = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value === value.trim(), 'text must not contain surrounding whitespace')

export const CanonicalMillisecondUtcTimestampSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
  }, 'timestamp must be canonical millisecond UTC ISO-8601')

export const OnboardingProfileV1Schema = z.object({
  displayName: strictTrimmedText(100),
  businessName: strictTrimmedText(120),
  tradeType: z.enum([
    'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting',
  ]),
  hourlyRateCents: z.number().finite().int().min(1).max(MAX_MONEY_CENTS),
  taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
  countryCode: z.literal('US'),
  currency: z.literal('USD'),
  timeZone: strictTrimmedText(100),
  onboardingVersion: z.literal(1),
  onboardingCompletedAt: CanonicalMillisecondUtcTimestampSchema,
}).strict()

export type OnboardingProfileV1 = z.infer<typeof OnboardingProfileV1Schema>

export type UserProfile = VersionedEntity & OnboardingProfileV1 & {
  logoPath?: string
}
