import { z } from 'zod'

import type { InvoiceDraft, LineItemDraft, PaymentTerms, TradeType } from './entities'
import {
  MAX_INVOICE_LINE_ITEMS,
  MAX_LINE_ITEM_DESCRIPTION_CODE_POINTS,
  MAX_MONEY_CENTS,
  MAX_QUANTITY_THOUSANDTHS,
  MAX_TAX_BASIS_POINTS,
} from './limits'
import type { MoneyCents } from './money'

const codePointLength = (value: string): number => Array.from(value).length

const assertMoneyLimit = (value: number): MoneyCents => {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > MAX_MONEY_CENTS) {
    throw new RangeError(`Money amount must be an integer between 0 and ${MAX_MONEY_CENTS} cents`)
  }

  return value
}

const LineItemDraftSchema = z
  .object({
    id: z.string().min(1).optional(),
    description: z
      .string()
      .min(1)
      .refine(
        (value) => codePointLength(value) <= MAX_LINE_ITEM_DESCRIPTION_CODE_POINTS,
        `Description must contain at most ${MAX_LINE_ITEM_DESCRIPTION_CODE_POINTS} Unicode code points`,
      ),
    type: z.enum(['labor', 'material']),
    quantity: z.number().finite().int().min(0).max(MAX_QUANTITY_THOUSANDTHS),
    unitPriceCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  })
  .strict()

export const InvoiceDraftSchema = z
  .object({
    clientName: z.string().min(1),
    jobTitle: z.string().min(1),
    jobAddress: z.string().optional(),
    jobDescription: z.string().optional(),
    tradeType: z.enum([
      'Plumbing',
      'Electrical',
      'HVAC',
      'Carpentry',
      'General',
      'Roofing',
      'Flooring',
      'Painting',
    ]),
    taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
    paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
    lineItems: z.array(LineItemDraftSchema).min(1).max(MAX_INVOICE_LINE_ITEMS),
    notes: z.string().optional(),
  })
  .strict()

export type CalculatedLineItem = LineItemDraft & {
  lineTotalCents: MoneyCents
}

export type CalculatedInvoice = InvoiceDraft & {
  lineItems: CalculatedLineItem[]
  subtotalCents: MoneyCents
  taxCents: MoneyCents
  totalCents: MoneyCents
}

export const calculateInvoice = (input: InvoiceDraft): CalculatedInvoice => {
  const draft = InvoiceDraftSchema.parse(input) as InvoiceDraft
  const lineItems = draft.lineItems.map((lineItem) => ({
    ...lineItem,
    lineTotalCents: assertMoneyLimit(
      Math.round((lineItem.quantity * lineItem.unitPriceCents) / 1000),
    ),
  }))
  const subtotalCents = assertMoneyLimit(
    lineItems.reduce((sum, lineItem) => sum + lineItem.lineTotalCents, 0),
  )
  const taxCents = assertMoneyLimit(Math.round((subtotalCents * draft.taxBasisPoints) / 10_000))
  const totalCents = assertMoneyLimit(subtotalCents + taxCents)

  return {
    ...draft,
    lineItems,
    subtotalCents,
    taxCents,
    totalCents,
  }
}

export type { InvoiceDraft, LineItemDraft, PaymentTerms, TradeType }
