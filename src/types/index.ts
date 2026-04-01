export type TradeType = 'Plumbing' | 'Electrical' | 'HVAC' | 'Carpentry' | 'General' | 'Roofing' | 'Flooring' | 'Painting'

export type JobStatus = 'Scheduled' | 'In Progress' | 'Invoiced' | 'Paid'

export type ExpenseCategory = 'Materials' | 'Fuel' | 'Equipment' | 'Subcontractor' | 'Other'

export type InvoicePaymentStatus = 'Draft' | 'Sent' | 'Viewed' | 'Partially Paid' | 'Paid'

export type MessageTone = 'Casual' | 'Professional' | 'Firm'

export interface LineItem {
  id?: string
  description: string
  quantity: number
  unitPrice: number
  total: number
  type: 'labor' | 'material'
}

export interface Invoice {
  id: string
  jobId: string
  number: string
  lineItems: LineItem[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  paymentStatus: InvoicePaymentStatus
  sentAt?: string
  paidAt?: string
  notes?: string
  paymentTerms: string
  createdAt: string
}

export interface Expense {
  id: string
  jobId?: string
  clientId?: string
  vendor: string
  category: ExpenseCategory
  amount: number
  date: string
  notes?: string
  receiptImageData?: string
  createdAt: string
}

export interface Client {
  id: string
  name: string
  phone: string
  email?: string
  address: string
  city: string
  state: string
  zip: string
  createdAt: string
}

export interface Job {
  id: string
  clientId: string
  clientName: string
  title: string
  tradeType: TradeType
  status: JobStatus
  description: string
  address: string
  laborHours: number
  laborRate: number
  invoiceId?: string
  invoiceTotal?: number
  expenseIds: string[]
  notes?: string
  scheduledAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface UserProfile {
  name: string
  businessName: string
  tradeType: TradeType
  hourlyRate: number
  phone?: string
  email?: string
  address?: string
  taxRate: number
  licenseNumber?: string
  onboardingComplete: boolean
}

export interface InventoryItem {
  id: string
  name: string
  quantity: number
  unit: string
  minStock: number
  lastUsed?: string
}
