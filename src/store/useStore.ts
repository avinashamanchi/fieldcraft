import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { Job, Client, Expense, Invoice, UserProfile, InventoryItem, Service, TradeType } from '../types'

const DEFAULT_PROFILE: UserProfile = {
  name: '',
  businessName: '',
  tradeType: 'General' as TradeType,
  hourlyRate: 95,
  taxRate: 0.08,
  onboardingComplete: false,
  hasSeenDemo: false,
}

// ─── DB → TypeScript mappers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function profileFromDb(r: Record<string, any>): UserProfile {
  return {
    name: r.name ?? '',
    businessName: r.business_name ?? '',
    tradeType: (r.trade_type ?? 'General') as TradeType,
    hourlyRate: Number(r.hourly_rate ?? 95),
    taxRate: Number(r.tax_rate ?? 0.08),
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    address: r.address ?? undefined,
    licenseNumber: r.license_number ?? undefined,
    logoDataUrl: r.logo_data_url ?? undefined,
    onboardingComplete: r.onboarding_complete ?? false,
    hasSeenDemo: r.has_seen_demo ?? false,
  }
}

function profileToDb(updates: Partial<UserProfile>): Record<string, unknown> {
  const db: Record<string, unknown> = {}
  if (updates.name !== undefined) db.name = updates.name
  if (updates.businessName !== undefined) db.business_name = updates.businessName
  if (updates.tradeType !== undefined) db.trade_type = updates.tradeType
  if (updates.hourlyRate !== undefined) db.hourly_rate = updates.hourlyRate
  if (updates.taxRate !== undefined) db.tax_rate = updates.taxRate
  if (updates.phone !== undefined) db.phone = updates.phone
  if (updates.email !== undefined) db.email = updates.email
  if (updates.address !== undefined) db.address = updates.address
  if (updates.licenseNumber !== undefined) db.license_number = updates.licenseNumber
  if (updates.logoDataUrl !== undefined) db.logo_data_url = updates.logoDataUrl
  if (updates.onboardingComplete !== undefined) db.onboarding_complete = updates.onboardingComplete
  if (updates.hasSeenDemo !== undefined) db.has_seen_demo = updates.hasSeenDemo
  db.updated_at = new Date().toISOString()
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobFromDb(r: Record<string, any>): Job {
  return {
    id: r.id,
    clientId: r.client_id ?? '',
    clientName: r.client_name ?? '',
    title: r.title ?? '',
    tradeType: (r.trade_type ?? 'General') as TradeType,
    status: r.status ?? 'Quoted',
    description: r.notes ?? '',
    address: r.address ?? '',
    laborHours: Number(r.labor_hours ?? 0),
    laborRate: Number(r.labor_rate ?? 95),
    invoiceId: r.invoice_id ?? undefined,
    invoiceTotal: r.invoice_total != null ? Number(r.invoice_total) : undefined,
    expenseIds: r.expense_ids ?? [],
    notes: r.notes ?? undefined,
    scheduledAt: r.scheduled_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
    updatedAt: r.updated_at ?? new Date().toISOString(),
  }
}

function jobToDb(job: Partial<Job> & { id?: string }, userId: string): Record<string, unknown> {
  const db: Record<string, unknown> = { user_id: userId }
  if (job.id !== undefined) db.id = job.id
  if (job.clientId !== undefined) db.client_id = job.clientId || null
  if (job.clientName !== undefined) db.client_name = job.clientName
  if (job.title !== undefined) db.title = job.title
  if (job.tradeType !== undefined) db.trade_type = job.tradeType
  if (job.status !== undefined) db.status = job.status
  if (job.description !== undefined) db.notes = job.description
  if (job.address !== undefined) db.address = job.address
  if (job.laborHours !== undefined) db.labor_hours = job.laborHours
  if (job.laborRate !== undefined) db.labor_rate = job.laborRate
  if (job.invoiceId !== undefined) db.invoice_id = job.invoiceId ?? null
  if (job.invoiceTotal !== undefined) db.invoice_total = job.invoiceTotal ?? null
  if (job.expenseIds !== undefined) db.expense_ids = job.expenseIds
  if (job.scheduledAt !== undefined) db.scheduled_at = job.scheduledAt ?? null
  if (job.completedAt !== undefined) db.completed_at = job.completedAt ?? null
  db.updated_at = new Date().toISOString()
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function invoiceFromDb(r: Record<string, any>): Invoice {
  return {
    id: r.id,
    jobId: r.job_id ?? '',
    number: r.number ?? '',
    lineItems: Array.isArray(r.line_items) ? r.line_items : [],
    subtotal: Number(r.subtotal ?? 0),
    taxRate: Number(r.tax_rate ?? 0.08),
    taxAmount: Number(r.tax_amount ?? 0),
    total: Number(r.total ?? 0),
    paymentStatus: r.payment_status ?? 'Draft',
    paymentTerms: r.payment_terms ?? 'Due on Receipt',
    notes: r.notes ?? undefined,
    sentAt: r.sent_at ?? undefined,
    paidAt: r.paid_at ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  }
}

function invoiceToDb(invoice: Partial<Invoice> & { id?: string }, userId: string): Record<string, unknown> {
  const db: Record<string, unknown> = { user_id: userId }
  if (invoice.id !== undefined) db.id = invoice.id
  if (invoice.jobId !== undefined) db.job_id = invoice.jobId || null
  if (invoice.number !== undefined) db.number = invoice.number
  if (invoice.lineItems !== undefined) db.line_items = invoice.lineItems
  if (invoice.subtotal !== undefined) db.subtotal = invoice.subtotal
  if (invoice.taxRate !== undefined) db.tax_rate = invoice.taxRate
  if (invoice.taxAmount !== undefined) db.tax_amount = invoice.taxAmount
  if (invoice.total !== undefined) db.total = invoice.total
  if (invoice.paymentStatus !== undefined) db.payment_status = invoice.paymentStatus
  if (invoice.paymentTerms !== undefined) db.payment_terms = invoice.paymentTerms
  if (invoice.notes !== undefined) db.notes = invoice.notes ?? null
  if (invoice.sentAt !== undefined) db.sent_at = invoice.sentAt ?? null
  if (invoice.paidAt !== undefined) db.paid_at = invoice.paidAt ?? null
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clientFromDb(r: Record<string, any>): Client {
  return {
    id: r.id,
    name: r.name ?? '',
    phone: r.phone ?? '',
    email: r.email ?? undefined,
    address: r.address ?? '',
    city: r.city ?? '',
    state: r.state ?? '',
    zip: r.zip ?? '',
    createdAt: r.created_at ?? new Date().toISOString(),
  }
}

function clientToDb(client: Partial<Client> & { id?: string }, userId: string): Record<string, unknown> {
  const db: Record<string, unknown> = { user_id: userId }
  if (client.id !== undefined) db.id = client.id
  if (client.name !== undefined) db.name = client.name
  if (client.phone !== undefined) db.phone = client.phone ?? null
  if (client.email !== undefined) db.email = client.email ?? null
  if (client.address !== undefined) db.address = client.address ?? null
  if (client.city !== undefined) db.city = client.city ?? null
  if (client.state !== undefined) db.state = client.state ?? null
  if (client.zip !== undefined) db.zip = client.zip ?? null
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expenseFromDb(r: Record<string, any>): Expense {
  return {
    id: r.id,
    jobId: r.job_id ?? undefined,
    vendor: r.vendor ?? '',
    category: r.category ?? 'Other',
    amount: Number(r.amount ?? 0),
    date: r.date ?? '',
    notes: r.notes ?? undefined,
    receiptImageData: r.receipt_uri ?? undefined,
    createdAt: r.created_at ?? new Date().toISOString(),
  }
}

function expenseToDb(expense: Partial<Expense> & { id?: string }, userId: string): Record<string, unknown> {
  const db: Record<string, unknown> = { user_id: userId }
  if (expense.id !== undefined) db.id = expense.id
  if (expense.jobId !== undefined) db.job_id = expense.jobId ?? null
  if (expense.vendor !== undefined) db.vendor = expense.vendor
  if (expense.category !== undefined) db.category = expense.category
  if (expense.amount !== undefined) db.amount = expense.amount
  if (expense.date !== undefined) db.date = expense.date
  if (expense.notes !== undefined) db.notes = expense.notes ?? null
  if (expense.receiptImageData !== undefined) db.receipt_uri = expense.receiptImageData ?? null
  return db
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serviceFromDb(r: Record<string, any>): Service {
  return {
    id: r.id,
    name: r.name ?? '',
    description: r.description ?? '',
    estimatedHours: Number(r.estimated_hours ?? 0),
    defaultPrice: Number(r.default_price ?? 0),
    category: r.category ?? undefined,
  }
}

function serviceToDb(service: Partial<Service> & { id?: string }, userId: string): Record<string, unknown> {
  const db: Record<string, unknown> = { user_id: userId }
  if (service.id !== undefined) db.id = service.id
  if (service.name !== undefined) db.name = service.name
  if (service.description !== undefined) db.description = service.description
  if (service.estimatedHours !== undefined) db.estimated_hours = service.estimatedHours
  if (service.defaultPrice !== undefined) db.default_price = service.defaultPrice
  if (service.category !== undefined) db.category = service.category ?? null
  return db
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface AppState {
  jobs: Job[]
  clients: Client[]
  expenses: Expense[]
  invoices: Invoice[]
  inventory: InventoryItem[]
  services: Service[]
  userProfile: UserProfile
  hydrated: boolean

  // Data loading / clearing
  loadUserData: () => Promise<void>
  clearUserData: () => void

  // Jobs
  addJob: (job: Job) => Promise<void>
  updateJob: (id: string, updates: Partial<Job>) => Promise<void>
  deleteJob: (id: string) => Promise<void>

  // Clients
  addClient: (client: Client) => Promise<void>
  updateClient: (id: string, updates: Partial<Client>) => Promise<void>
  deleteClient: (id: string) => Promise<void>

  // Expenses
  addExpense: (expense: Expense) => Promise<void>
  updateExpense: (id: string, updates: Partial<Expense>) => Promise<void>
  deleteExpense: (id: string) => Promise<void>

  // Invoices
  addInvoice: (invoice: Invoice) => Promise<void>
  updateInvoice: (id: string, updates: Partial<Invoice>) => Promise<void>
  deleteInvoice: (id: string) => Promise<void>

  // Inventory (local-only, kept in Zustand)
  addInventoryItem: (item: InventoryItem) => void
  updateInventoryItem: (id: string, updates: Partial<InventoryItem>) => void
  deleteInventoryItem: (id: string) => void

  // Services
  addService: (service: Service) => Promise<void>
  updateService: (id: string, updates: Partial<Service>) => Promise<void>
  deleteService: (id: string) => Promise<void>

  // User profile
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>

  // Legacy setter for hydrated (used during initial load)
  setHydrated: () => void
}

// ─── Helper to get current user ID ───────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useStore = create<AppState>()((set, get) => ({
  jobs: [],
  clients: [],
  expenses: [],
  invoices: [],
  inventory: [],
  services: [],
  userProfile: { ...DEFAULT_PROFILE },
  hydrated: false,

  // ── Load all user data from Supabase in parallel ────────────────────────────
  loadUserData: async () => {
    const userId = await getUserId()
    if (!userId) {
      set({ hydrated: true })
      return
    }

    const [profileRes, jobsRes, invoicesRes, clientsRes, expensesRes, servicesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('jobs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('clients').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('expenses').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('services').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    ])

    set({
      userProfile: profileRes.data ? profileFromDb(profileRes.data) : { ...DEFAULT_PROFILE },
      jobs: (jobsRes.data ?? []).map(jobFromDb),
      invoices: (invoicesRes.data ?? []).map(invoiceFromDb),
      clients: (clientsRes.data ?? []).map(clientFromDb),
      expenses: (expensesRes.data ?? []).map(expenseFromDb),
      services: (servicesRes.data ?? []).map(serviceFromDb),
      hydrated: true,
    })
  },

  // ── Clear all user data on sign out ─────────────────────────────────────────
  clearUserData: () => {
    set({
      jobs: [],
      clients: [],
      expenses: [],
      invoices: [],
      inventory: [],
      services: [],
      userProfile: { ...DEFAULT_PROFILE },
      hydrated: false,
    })
  },

  // ── Jobs ────────────────────────────────────────────────────────────────────
  addJob: async (job) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('jobs').insert(jobToDb(job, userId))
    if (!error) set((s) => ({ jobs: [job, ...s.jobs] }))
    else console.error('addJob error:', error)
  },

  updateJob: async (id, updates) => {
    const userId = await getUserId()
    if (!userId) return
    const dbUpdates = jobToDb(updates, userId)
    delete dbUpdates.user_id
    const { error } = await supabase.from('jobs').update(dbUpdates).eq('id', id).eq('user_id', userId)
    if (!error) {
      set((s) => ({
        jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j)),
      }))
    } else {
      console.error('updateJob error:', error)
    }
  },

  deleteJob: async (id) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('jobs').delete().eq('id', id).eq('user_id', userId)
    if (!error) set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
    else console.error('deleteJob error:', error)
  },

  // ── Clients ─────────────────────────────────────────────────────────────────
  addClient: async (client) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('clients').insert(clientToDb(client, userId))
    if (!error) set((s) => ({ clients: [client, ...s.clients] }))
    else console.error('addClient error:', error)
  },

  updateClient: async (id, updates) => {
    const userId = await getUserId()
    if (!userId) return
    const dbUpdates = clientToDb(updates, userId)
    delete dbUpdates.user_id
    const { error } = await supabase.from('clients').update(dbUpdates).eq('id', id).eq('user_id', userId)
    if (!error) {
      set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...updates } : c)) }))
    } else {
      console.error('updateClient error:', error)
    }
  },

  deleteClient: async (id) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('clients').delete().eq('id', id).eq('user_id', userId)
    if (!error) set((s) => ({ clients: s.clients.filter((c) => c.id !== id) }))
    else console.error('deleteClient error:', error)
  },

  // ── Expenses ─────────────────────────────────────────────────────────────────
  addExpense: async (expense) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('expenses').insert(expenseToDb(expense, userId))
    if (!error) set((s) => ({ expenses: [expense, ...s.expenses] }))
    else console.error('addExpense error:', error)
  },

  updateExpense: async (id, updates) => {
    const userId = await getUserId()
    if (!userId) return
    const dbUpdates = expenseToDb(updates, userId)
    delete dbUpdates.user_id
    const { error } = await supabase.from('expenses').update(dbUpdates).eq('id', id).eq('user_id', userId)
    if (!error) {
      set((s) => ({ expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...updates } : e)) }))
    } else {
      console.error('updateExpense error:', error)
    }
  },

  deleteExpense: async (id) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('expenses').delete().eq('id', id).eq('user_id', userId)
    if (!error) set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) }))
    else console.error('deleteExpense error:', error)
  },

  // ── Invoices ─────────────────────────────────────────────────────────────────
  addInvoice: async (invoice) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('invoices').insert(invoiceToDb(invoice, userId))
    if (!error) set((s) => ({ invoices: [invoice, ...s.invoices] }))
    else console.error('addInvoice error:', error)
  },

  updateInvoice: async (id, updates) => {
    const userId = await getUserId()
    if (!userId) return
    const dbUpdates = invoiceToDb(updates, userId)
    delete dbUpdates.user_id
    const { error } = await supabase.from('invoices').update(dbUpdates).eq('id', id).eq('user_id', userId)
    if (!error) {
      set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...updates } : i)) }))
    } else {
      console.error('updateInvoice error:', error)
    }
  },

  deleteInvoice: async (id) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('invoices').delete().eq('id', id).eq('user_id', userId)
    if (!error) set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) }))
    else console.error('deleteInvoice error:', error)
  },

  // ── Inventory (local-only) ──────────────────────────────────────────────────
  addInventoryItem: (item) => set((s) => ({ inventory: [item, ...s.inventory] })),
  updateInventoryItem: (id, updates) =>
    set((s) => ({ inventory: s.inventory.map((i) => (i.id === id ? { ...i, ...updates } : i)) })),
  deleteInventoryItem: (id) => set((s) => ({ inventory: s.inventory.filter((i) => i.id !== id) })),

  // ── Services ─────────────────────────────────────────────────────────────────
  addService: async (service) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('services').insert(serviceToDb(service, userId))
    if (!error) set((s) => ({ services: [service, ...s.services] }))
    else console.error('addService error:', error)
  },

  updateService: async (id, updates) => {
    const userId = await getUserId()
    if (!userId) return
    const dbUpdates = serviceToDb(updates, userId)
    delete dbUpdates.user_id
    const { error } = await supabase.from('services').update(dbUpdates).eq('id', id).eq('user_id', userId)
    if (!error) {
      set((s) => ({ services: s.services.map((sv) => (sv.id === id ? { ...sv, ...updates } : sv)) }))
    } else {
      console.error('updateService error:', error)
    }
  },

  deleteService: async (id) => {
    const userId = await getUserId()
    if (!userId) return
    const { error } = await supabase.from('services').delete().eq('id', id).eq('user_id', userId)
    if (!error) set((s) => ({ services: s.services.filter((sv) => sv.id !== id) }))
    else console.error('deleteService error:', error)
  },

  // ── User profile ──────────────────────────────────────────────────────────────
  updateUserProfile: async (updates) => {
    // Optimistic update first
    set((s) => ({ userProfile: { ...s.userProfile, ...updates } }))

    const userId = await getUserId()
    if (!userId) return

    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, ...profileToDb(updates) }, { onConflict: 'id' })

    if (error) {
      console.error('updateUserProfile error:', error)
      // Revert on error by reloading
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
      if (data) set({ userProfile: profileFromDb(data) })
    }
  },

  // Legacy setter
  setHydrated: () => set({ hydrated: true }),
}))

// ─── Derived selectors ────────────────────────────────────────────────────────

export const selectJobsByClient = (clientId: string) => (s: AppState) =>
  s.jobs.filter((j) => j.clientId === clientId)

export const selectExpensesByJob = (jobId: string) => (s: AppState) =>
  s.expenses.filter((e) => e.jobId === jobId)

export const selectInvoiceByJob = (jobId: string) => (s: AppState) =>
  s.invoices.find((i) => i.jobId === jobId)

export const selectClientTotals = (clientId: string) => (s: AppState) => {
  const clientJobs = s.jobs.filter((j) => j.clientId === clientId)
  const totalBilled = clientJobs.reduce((sum, j) => sum + (j.invoiceTotal ?? 0), 0)
  const totalPaid = clientJobs
    .filter((j) => j.status === 'Paid')
    .reduce((sum, j) => sum + (j.invoiceTotal ?? 0), 0)
  return { totalBilled, totalPaid, outstanding: totalBilled - totalPaid }
}
