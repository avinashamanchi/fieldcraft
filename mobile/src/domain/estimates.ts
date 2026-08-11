import { z } from 'zod'

import { CanonicalMillisecondUtcTimestampSchema } from './entities'
import { calculateInvoice } from './invoice'
import { MAX_INVOICE_LINE_ITEMS, MAX_MONEY_CENTS, MAX_TAX_BASIS_POINTS } from './limits'
import type { LineItemDraft } from './entities'
import type { MoneyCents } from './money'

export type EstimateStatus =
  | 'Draft'
  | 'Issued'
  | 'Accepted'
  | 'Declined'
  | 'Expired'
  | 'Converted'
  | 'Void'

export type EstimateDraft = Readonly<{
  clientId: string
  title: string
  scope: string
  lineItems: LineItemDraft[]
  taxBasisPoints: number
  notes?: string
}>

export type IssuedEstimateSnapshot = Readonly<{
  clientId: string
  title: string
  scope: string
  lineItems: readonly Readonly<LineItemDraft & { lineTotalCents: MoneyCents }>[]
  taxBasisPoints: number
  subtotalCents: MoneyCents
  taxCents: MoneyCents
  totalCents: MoneyCents
  notes?: string
}>

export type IssuedEstimate = Readonly<{
  status: 'Issued'
  number: string
  revision: number
  issuedAt: string
  expiresAt: string
  issuedSnapshot: IssuedEstimateSnapshot
}>

const uuid = z.string().uuid()
const boundedText = (maximum: number) => z.string().trim().min(1).refine(
  (value) => Array.from(value).length <= maximum && !value.includes('\u0000'),
  `text must contain at most ${maximum} Unicode code points`,
)
const EstimateDraftSchema = z.object({
  clientId: uuid,
  title: boundedText(200),
  scope: boundedText(4_000),
  lineItems: z.array(z.unknown()).min(1).max(MAX_INVOICE_LINE_ITEMS),
  taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  notes: z.string().max(4_000).optional(),
}).strict()

const TRANSITIONS: Readonly<Record<EstimateStatus, ReadonlySet<EstimateStatus>>> = Object.freeze({
  Draft: new Set<EstimateStatus>(['Issued', 'Void']),
  Issued: new Set<EstimateStatus>(['Accepted', 'Declined', 'Expired', 'Void']),
  Accepted: new Set<EstimateStatus>(['Converted', 'Void']),
  Declined: new Set<EstimateStatus>(),
  Expired: new Set<EstimateStatus>(),
  Converted: new Set<EstimateStatus>(),
  Void: new Set<EstimateStatus>(),
})

export const assertEstimateTransition = (from: EstimateStatus, to: EstimateStatus): void => {
  if (!TRANSITIONS[from]?.has(to)) throw new Error('INVALID_ESTIMATE_TRANSITION')
}

const freezeLineItems = (
  lineItems: readonly (LineItemDraft & { lineTotalCents: MoneyCents })[],
): IssuedEstimateSnapshot['lineItems'] => Object.freeze(
  lineItems.map((item) => Object.freeze({ ...item })),
)

export const issueEstimate = (
  input: EstimateDraft,
  options: Readonly<{ number: string; issuedAt: string; expiresAt: string; revision: number }>,
): IssuedEstimate => {
  const parsed = EstimateDraftSchema.parse(input) as EstimateDraft
  const number = options.number.trim()
  if (!number || Array.from(number).length > 64) throw new Error('INVALID_ESTIMATE_NUMBER')
  if (!Number.isSafeInteger(options.revision) || options.revision < 1) throw new Error('INVALID_ESTIMATE_REVISION')
  const issuedAt = CanonicalMillisecondUtcTimestampSchema.parse(options.issuedAt)
  const expiresAt = CanonicalMillisecondUtcTimestampSchema.parse(options.expiresAt)
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('INVALID_ESTIMATE_EXPIRATION')

  const calculated = calculateInvoice({
    clientName: 'Estimate client',
    jobTitle: parsed.title,
    jobDescription: parsed.scope,
    tradeType: 'General',
    taxBasisPoints: parsed.taxBasisPoints,
    paymentTerms: 'Due on receipt',
    lineItems: parsed.lineItems,
    notes: parsed.notes,
  })
  if (calculated.totalCents > MAX_MONEY_CENTS) throw new Error('INVALID_ESTIMATE_TOTAL')

  const issuedSnapshot: IssuedEstimateSnapshot = Object.freeze({
    clientId: parsed.clientId,
    title: parsed.title,
    scope: parsed.scope,
    lineItems: freezeLineItems(calculated.lineItems),
    taxBasisPoints: parsed.taxBasisPoints,
    subtotalCents: calculated.subtotalCents,
    taxCents: calculated.taxCents,
    totalCents: calculated.totalCents,
    ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
  })

  return Object.freeze({
    status: 'Issued',
    number,
    revision: options.revision,
    issuedAt,
    expiresAt,
    issuedSnapshot,
  })
}
