import { z } from 'zod'

import type { LineItemDraft } from '../../domain/entities'
import { calculateInvoice } from '../../domain/invoice'
import {
  MAX_INVOICE_LINE_ITEMS,
  MAX_MONEY_CENTS,
  MAX_TAX_BASIS_POINTS,
} from '../../domain/limits'

export type EstimateDraftInput = Readonly<{
  clientId: string
  title: string
  scope: string
  lineItems: LineItemDraft[]
  taxBasisPoints: number
  expiresAt: string
  notes?: string
}>

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) return true
      index += 1
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return true
  }
  return false
}

const safeText = (maximum: number) => z.string().refine(
  (value) => Array.from(value).length <= maximum && !value.includes('\u0000') && !hasUnpairedSurrogate(value),
  `Must contain at most ${maximum} safe characters`,
)

const codePoints = (maximum: number) => safeText(maximum).pipe(z.string().trim().min(1)).refine(
  (value) => Array.from(value).length <= maximum,
  `Must contain at most ${maximum} characters`,
)

export const EstimateDraftInputSchema = z.object({
  clientId: z.uuid(),
  title: codePoints(200),
  scope: codePoints(4_000),
  lineItems: z.array(z.object({
    id: z.string().min(1).optional(),
    description: codePoints(500),
    type: z.enum(['labor', 'material']),
    quantity: z.number().finite().int().min(0).max(10_000),
    unitPriceCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  }).strict()).min(1).max(MAX_INVOICE_LINE_ITEMS),
  taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  expiresAt: z.iso.datetime({ offset: true }),
  notes: safeText(4_000).optional(),
}).strict()

export const calculateEstimateDraft = (input: EstimateDraftInput) => {
  const parsed = EstimateDraftInputSchema.parse(input) as EstimateDraftInput
  const calculated = calculateInvoice({
    clientName: 'Estimate client',
    jobTitle: parsed.title,
    jobDescription: parsed.scope,
    tradeType: 'General',
    taxBasisPoints: parsed.taxBasisPoints,
    paymentTerms: 'Due on receipt',
    lineItems: parsed.lineItems,
    ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
  })
  return {
    ...parsed,
    title: parsed.title.trim(),
    scope: parsed.scope.trim(),
    lineItems: parsed.lineItems.map((line) => ({ ...line, description: line.description.trim() })),
    subtotalCents: calculated.subtotalCents,
    taxCents: calculated.taxCents,
    totalCents: calculated.totalCents,
  }
}
