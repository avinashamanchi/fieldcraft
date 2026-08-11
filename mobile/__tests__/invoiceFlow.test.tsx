import { fireEvent, render, screen } from '@testing-library/react-native'
import { useState } from 'react'

import type { InvoiceDraft } from '../src/domain/entities'
import { InvoiceEditor, canAddInvoiceLine } from '../src/features/invoices/InvoiceEditor'

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
