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
  amountCents: MoneyCents
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

export type UserProfile = VersionedEntity & {
  businessName: string
}
