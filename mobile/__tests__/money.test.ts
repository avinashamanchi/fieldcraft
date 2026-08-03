import { calculateInvoice } from '../src/domain/invoice'

it('calculates integer-cent totals instead of trusting supplied AI totals', () => {
  const result = calculateInvoice({
    clientName: 'Jordan Lee',
    jobTitle: 'Replace valve',
    tradeType: 'Plumbing',
    taxBasisPoints: 825,
    paymentTerms: 'Due on receipt',
    lineItems: [
      { description: 'Labor', type: 'labor', quantity: 1500, unitPriceCents: 10000 },
      { description: 'Valve', type: 'material', quantity: 1000, unitPriceCents: 2599 },
    ],
  })

  expect(result.subtotalCents).toBe(17599)
  expect(result.taxCents).toBe(1452)
  expect(result.totalCents).toBe(19051)
})

it('rejects calculations whose line total exceeds the money limit', () => {
  expect(() =>
    calculateInvoice({
      clientName: 'Jordan Lee',
      jobTitle: 'Replace valve',
      tradeType: 'Plumbing',
      taxBasisPoints: 0,
      paymentTerms: 'Due on receipt',
      lineItems: [
        {
          description: 'Labor',
          type: 'labor',
          quantity: 10000,
          unitPriceCents: 100000000,
        },
      ],
    }),
  ).toThrow()
})
