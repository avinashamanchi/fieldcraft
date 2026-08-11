import { parseReceipt } from '../src/features/expenses/receiptParser'

it('deterministically extracts vendor, date, and labeled grand total', () => {
  const parsed = parseReceipt({
    text: 'FIELD SUPPLY\n08/06/2026\nSubtotal $10.00\nTax $0.83\nTOTAL $10.83', confidence: 0.94,
    observations: [
      { text: 'FIELD SUPPLY', confidence: 0.98, x: 0.1, y: 0.9 },
      { text: '08/06/2026', confidence: 0.94, x: 0.1, y: 0.8 },
      { text: 'Subtotal $10.00', confidence: 0.93, x: 0.1, y: 0.3 },
      { text: 'TOTAL $10.83', confidence: 0.96, x: 0.1, y: 0.1 },
    ],
  })
  expect(parsed).toMatchObject({ vendor: 'FIELD SUPPLY', expenseDate: '2026-08-06', amountCents: 1083, confidence: 0.94, manualReviewRequired: false })
})

it('requires manual review for low confidence or missing candidates', () => {
  expect(parseReceipt({ text: 'blur', confidence: 0.4, observations: [] })).toMatchObject({ category: 'Other', manualReviewRequired: true })
})
