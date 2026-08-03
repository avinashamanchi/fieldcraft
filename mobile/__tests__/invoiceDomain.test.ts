import Ajv from 'ajv'

import { calculateInvoice, InvoiceDraftSchema } from '../src/domain/invoice'

const invoiceSchema = require('../../contracts/fieldcraft.v1.schema.json')
const validInvoiceFixture = require('../../contracts/fixtures/invoice.valid.json')
const invalidInvoiceFixture = require('../../contracts/fixtures/invoice.invalid.json')

const validDraft = (description: string) => ({
  clientName: 'Jordan Lee',
  jobTitle: 'Replace valve',
  tradeType: 'Plumbing',
  taxBasisPoints: 825,
  paymentTerms: 'Due on receipt',
  lineItems: [
    { description, type: 'labor', quantity: 1000, unitPriceCents: 10000 },
  ],
})

it('counts Unicode code points at exact description boundaries', () => {
  expect(InvoiceDraftSchema.safeParse(validDraft('🧰'.repeat(500))).success).toBe(true)
  expect(InvoiceDraftSchema.safeParse(validDraft('🧰'.repeat(501))).success).toBe(false)
})

it('enforces the versioned JSON and Zod invoice contracts', () => {
  const validateJson = new Ajv({ allErrors: true }).compile(invoiceSchema)

  expect(validateJson(validInvoiceFixture)).toBe(true)
  expect(validateJson(invalidInvoiceFixture)).toBe(false)
  expect(InvoiceDraftSchema.safeParse(validInvoiceFixture).success).toBe(true)
  expect(InvoiceDraftSchema.safeParse(invalidInvoiceFixture).success).toBe(false)

  const unknownKey = { ...validInvoiceFixture, suppliedAiTotalCents: 1 }
  const tooManyLines = {
    ...validInvoiceFixture,
    lineItems: Array.from({ length: 101 }, () => validInvoiceFixture.lineItems[0]),
  }
  const nonIntegerCents = {
    ...validInvoiceFixture,
    lineItems: [{ ...validInvoiceFixture.lineItems[0], unitPriceCents: 2599.5 }],
  }
  const negativeValue = {
    ...validInvoiceFixture,
    lineItems: [{ ...validInvoiceFixture.lineItems[0], quantity: -1 }],
  }
  const nanValue = {
    ...validInvoiceFixture,
    lineItems: [{ ...validInvoiceFixture.lineItems[0], quantity: Number.NaN }],
  }
  const infiniteValue = {
    ...validInvoiceFixture,
    lineItems: [{ ...validInvoiceFixture.lineItems[0], unitPriceCents: Infinity }],
  }
  const tooLongDescription = {
    ...validInvoiceFixture,
    lineItems: [{ ...validInvoiceFixture.lineItems[0], description: '🧰'.repeat(501) }],
  }

  for (const invalidDraft of [
    unknownKey,
    tooManyLines,
    nonIntegerCents,
    negativeValue,
    nanValue,
    infiniteValue,
    tooLongDescription,
  ]) {
    expect(validateJson(invalidDraft)).toBe(false)
    expect(InvoiceDraftSchema.safeParse(invalidDraft).success).toBe(false)
    expect(() => calculateInvoice(invalidDraft)).toThrow()
  }
})
