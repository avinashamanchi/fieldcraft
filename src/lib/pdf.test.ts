import { afterEach, expect, it, vi } from 'vitest'

import { printInvoice } from './pdf'
import type { Invoice, Job, UserProfile } from '../types'

afterEach(() => vi.restoreAllMocks())

it('escapes user-controlled invoice text before writing printable HTML', () => {
  let written = ''
  vi.spyOn(window, 'open').mockReturnValue({
    document: {
      write: (value: string) => { written = value },
      close: () => undefined,
    },
  } as unknown as Window)

  const marker = '<img src=x onerror=alert(1)>'
  const invoice: Invoice = {
    id: 'invoice-1',
    jobId: 'job-1',
    number: marker,
    lineItems: [{ description: marker, quantity: 1, unitPrice: 100, total: 100, type: 'labor' }],
    subtotal: 100,
    taxRate: 0,
    taxAmount: 0,
    total: 100,
    paymentStatus: 'Draft',
    notes: marker,
    paymentTerms: marker,
    createdAt: '2026-08-11T00:00:00.000Z',
  }
  const job: Job = {
    id: 'job-1', clientId: 'client-1', clientName: marker, title: 'Test', tradeType: 'General',
    status: 'Invoiced', description: '', address: marker, laborHours: 1, laborRate: 100,
    expenseIds: [], createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
  }
  const profile: UserProfile = {
    name: marker, businessName: marker, tradeType: 'General', hourlyRate: 100,
    address: marker, phone: marker, taxRate: 0, onboardingComplete: true,
  }

  printInvoice(invoice, job, profile)

  expect(written).not.toContain(marker)
  expect(written).toContain('&lt;img src=x onerror=alert(1)&gt;')
})
