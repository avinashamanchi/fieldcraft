import { z } from 'zod'

import { MAX_MONEY_CENTS, MAX_TAX_BASIS_POINTS } from '../domain/limits'

export const AI_CONSENT_VERSION = '2026-08-03' as const
const codePoints = (maximum: number) => z.string().refine((value) => Array.from(value).length <= maximum)
const tradeType = z.enum(['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting'])

export const InvoiceParseRequestSchema = z.object({
  route: z.literal('invoice.parse.v1'),
  consentVersion: z.literal(AI_CONSENT_VERSION),
  transcript: codePoints(20_000).pipe(z.string().min(1)),
  defaults: z.object({
    tradeType,
    hourlyRateCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
    taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  }).strict(),
}).strict()

export const ExpenseCategorizeRequestSchema = z.object({
  route: z.literal('expense.categorize.v1'),
  consentVersion: z.literal(AI_CONSENT_VERSION),
  vendor: codePoints(200).pipe(z.string().min(1)),
  amountCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  notes: codePoints(4000),
}).strict()

export const MessageDraftRequestSchema = z.object({
  route: z.literal('message.draft.v1'),
  consentVersion: z.literal(AI_CONSENT_VERSION),
  tone: z.enum(['Casual', 'Professional', 'Firm']),
  context: codePoints(20_000).pipe(z.string().min(1)),
}).strict()

export const AiRequestSchema = z.discriminatedUnion('route', [
  InvoiceParseRequestSchema,
  ExpenseCategorizeRequestSchema,
  MessageDraftRequestSchema,
])

const invoiceResult = z.object({
  clientName: codePoints(200).pipe(z.string().min(1)),
  jobTitle: codePoints(200).pipe(z.string().min(1)),
  jobAddress: codePoints(500).optional(),
  jobDescription: codePoints(4000).optional(),
  tradeType,
  taxBasisPoints: z.number().finite().int().min(0).max(MAX_TAX_BASIS_POINTS),
  paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
  lineItems: z.array(z.object({
    description: codePoints(500).pipe(z.string().min(1)),
    type: z.enum(['labor', 'material']),
    quantity: z.number().finite().int().min(0).max(10_000),
    unitPriceCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  }).strict()).min(1).max(100),
  notes: codePoints(4000).optional(),
}).strict()

const responseSchemas = {
  'invoice.parse.v1': z.object({ route: z.literal('invoice.parse.v1'), version: z.literal(1), result: invoiceResult }).strict(),
  'expense.categorize.v1': z.object({
    route: z.literal('expense.categorize.v1'), version: z.literal(1),
    result: z.object({ category: z.enum(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other']) }).strict(),
  }).strict(),
  'message.draft.v1': z.object({
    route: z.literal('message.draft.v1'), version: z.literal(1),
    result: z.object({ message: codePoints(4000).pipe(z.string().min(1)) }).strict(),
  }).strict(),
} as const

export type AiRequest = z.infer<typeof AiRequestSchema>
export type InvoiceParseRequestV1 = z.infer<typeof InvoiceParseRequestSchema>
export type ExpenseCategorizeRequestV1 = z.infer<typeof ExpenseCategorizeRequestSchema>
export type MessageDraftRequestV1 = z.infer<typeof MessageDraftRequestSchema>
export type AiResultFor<T extends AiRequest['route']> = z.infer<(typeof responseSchemas)[T]>['result']

export const parseAiResponse = <T extends AiRequest['route']>(route: T, input: unknown): AiResultFor<T> =>
  responseSchemas[route].parse(input).result as AiResultFor<T>
