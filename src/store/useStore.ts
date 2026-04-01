import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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

interface AppState {
  jobs: Job[]
  clients: Client[]
  expenses: Expense[]
  invoices: Invoice[]
  inventory: InventoryItem[]
  services: Service[]
  userProfile: UserProfile
  hydrated: boolean

  // Jobs
  addJob: (job: Job) => void
  updateJob: (id: string, updates: Partial<Job>) => void
  deleteJob: (id: string) => void

  // Clients
  addClient: (client: Client) => void
  updateClient: (id: string, updates: Partial<Client>) => void
  deleteClient: (id: string) => void

  // Expenses
  addExpense: (expense: Expense) => void
  updateExpense: (id: string, updates: Partial<Expense>) => void
  deleteExpense: (id: string) => void

  // Invoices
  addInvoice: (invoice: Invoice) => void
  updateInvoice: (id: string, updates: Partial<Invoice>) => void

  // Inventory
  addInventoryItem: (item: InventoryItem) => void
  updateInventoryItem: (id: string, updates: Partial<InventoryItem>) => void
  deleteInventoryItem: (id: string) => void

  // Services
  addService: (service: Service) => void
  updateService: (id: string, updates: Partial<Service>) => void
  deleteService: (id: string) => void

  // User
  updateUserProfile: (updates: Partial<UserProfile>) => void

  setHydrated: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      jobs: [],
      clients: [],
      expenses: [],
      invoices: [],
      inventory: [],
      services: [],
      userProfile: { ...DEFAULT_PROFILE },
      hydrated: false,

      addJob: (job) => set((s) => ({ jobs: [job, ...s.jobs] })),
      updateJob: (id, updates) =>
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j)),
        })),
      deleteJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

      addClient: (client) => set((s) => ({ clients: [client, ...s.clients] })),
      updateClient: (id, updates) =>
        set((s) => ({ clients: s.clients.map((c) => (c.id === id ? { ...c, ...updates } : c)) })),
      deleteClient: (id) => set((s) => ({ clients: s.clients.filter((c) => c.id !== id) })),

      addExpense: (expense) => set((s) => ({ expenses: [expense, ...s.expenses] })),
      updateExpense: (id, updates) =>
        set((s) => ({ expenses: s.expenses.map((e) => (e.id === id ? { ...e, ...updates } : e)) })),
      deleteExpense: (id) => set((s) => ({ expenses: s.expenses.filter((e) => e.id !== id) })),

      addInvoice: (invoice) => set((s) => ({ invoices: [invoice, ...s.invoices] })),
      updateInvoice: (id, updates) =>
        set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...updates } : i)) })),

      addInventoryItem: (item) => set((s) => ({ inventory: [item, ...s.inventory] })),
      updateInventoryItem: (id, updates) =>
        set((s) => ({ inventory: s.inventory.map((i) => (i.id === id ? { ...i, ...updates } : i)) })),
      deleteInventoryItem: (id) => set((s) => ({ inventory: s.inventory.filter((i) => i.id !== id) })),

      addService: (service) => set((s) => ({ services: [service, ...s.services] })),
      updateService: (id, updates) =>
        set((s) => ({ services: s.services.map((sv) => (sv.id === id ? { ...sv, ...updates } : sv)) })),
      deleteService: (id) => set((s) => ({ services: s.services.filter((sv) => sv.id !== id) })),

      updateUserProfile: (updates) =>
        set((s) => ({ userProfile: { ...s.userProfile, ...updates } })),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'fieldcraft-store',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        if (state) state.setHydrated()
      },
    }
  )
)

// Derived selectors
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
