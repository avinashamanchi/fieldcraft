import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Job, Client, Expense, Invoice, UserProfile, InventoryItem } from '../types'
import {
  SEED_JOBS,
  SEED_CLIENTS,
  SEED_EXPENSES,
  SEED_INVOICES,
  SEED_INVENTORY,
  SEED_USER,
} from '../constants/seed-data'

interface AppState {
  jobs: Job[]
  clients: Client[]
  expenses: Expense[]
  invoices: Invoice[]
  inventory: InventoryItem[]
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

  // User
  updateUserProfile: (updates: Partial<UserProfile>) => void

  setHydrated: () => void
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      jobs: SEED_JOBS,
      clients: SEED_CLIENTS,
      expenses: SEED_EXPENSES,
      invoices: SEED_INVOICES,
      inventory: SEED_INVENTORY,
      userProfile: { ...SEED_USER, onboardingComplete: false },
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
