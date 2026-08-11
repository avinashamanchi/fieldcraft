import { fireEvent, render, screen } from '@testing-library/react-native'
import { useState } from 'react'

import type { InvoiceDraft } from '../src/domain/entities'
import { InvoiceEditor, canAddInvoiceLine } from '../src/features/invoices/InvoiceEditor'
import { buildIssueInvoiceMutation } from '../src/features/invoices/saveInvoiceBundle'
import type { Invoice } from '../src/domain/entities'

const initial: InvoiceDraft = {
  clientName: 'Mina', jobTitle: 'Valve replacement', tradeType: 'Plumbing', taxBasisPoints: 825,
  paymentTerms: 'Due on receipt', lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 10_000 }],
}

const ControlledEditor = () => {
  const [draft, setDraft] = useState(initial)
  return <InvoiceEditor draft={draft} onChange={setDraft} onContinue={() => {}} />
}

it('supports fully local typed invoice entry and recomputes authoritative totals', () => {
  render(<ControlledEditor />)
  expect(screen.getByText('$108.25')).toBeTruthy()
  fireEvent.changeText(screen.getByTestId('line-price-0'), '200.00')
  expect(screen.getByText('$216.50')).toBeTruthy()
})

it('enforces the 100-line boundary and disables continuation for an invalid draft', () => {
  expect(canAddInvoiceLine(Array.from({ length: 99 }))).toBe(true)
  expect(canAddInvoiceLine(Array.from({ length: 100 }))).toBe(false)
  render(<InvoiceEditor draft={{ ...initial, clientName: '' }} onChange={() => {}} onContinue={() => {}} />)
  expect(screen.getByTestId('continue-invoice').props.accessibilityState.disabled).toBe(true)
})

it('builds one offline-safe invoice issuance with the reviewed due date', () => {
  const invoice: Invoice = {
    id: '10000000-0000-4000-8000-000000000001',
    ownerId: '20000000-0000-4000-8000-000000000001',
    clientId: '30000000-0000-4000-8000-000000000001',
    draft: { ...initial, paymentTerms: 'Net 14' },
    subtotalCents: 10_000, taxCents: 825, totalCents: 10_825,
    status: 'Draft', version: 1,
    createdAt: '2026-08-10T20:00:00.000Z', updatedAt: '2026-08-10T20:00:00.000Z',
    syncState: 'pending',
  }
  const mutation = buildIssueInvoiceMutation({
    invoice,
    mutationId: '40000000-0000-4000-8000-000000000001',
    issuedAt: '2026-08-11T20:00:00.000Z',
  })
  expect(mutation).toMatchObject({
    kind: 'issue_invoice', baseVersion: 1,
    payload: {
      dueAt: '2026-08-25T20:00:00.000Z',
      invoice: { status: 'Issued', version: 2 },
    },
  })
})
