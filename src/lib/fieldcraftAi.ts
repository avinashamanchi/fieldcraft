import { z } from 'zod'

import { supabase } from './supabase'
import type { MessageTone, TradeType } from '../types'

export const AI_CONSENT_VERSION = '2026-08-03' as const
const MAX_RESPONSE_BYTES = 128 * 1024
const CONSENT_KEY = 'fieldcraft.ai-consent'

const ExpenseResponseSchema = z.object({
  route: z.literal('expense.categorize.v1'), version: z.literal(1),
  result: z.object({ category: z.enum(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other']) }).strict(),
}).strict()
const MessageResponseSchema = z.object({
  route: z.literal('message.draft.v1'), version: z.literal(1),
  result: z.object({ message: z.string().min(1).max(4000) }).strict(),
}).strict()
const InvoiceResponseSchema = z.object({
  route: z.literal('invoice.parse.v1'), version: z.literal(1),
  result: z.object({
    clientName: z.string().min(1).max(200), jobTitle: z.string().min(1).max(200),
    jobAddress: z.string().max(500).optional(), jobDescription: z.string().max(4000).optional(),
    tradeType: z.enum(['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']),
    taxBasisPoints: z.number().int().min(0).max(10_000),
    paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
    lineItems: z.array(z.object({
      description: z.string().min(1).max(500), type: z.enum(['labor', 'material']),
      quantity: z.number().int().min(0).max(10_000), unitPriceCents: z.number().int().min(0).max(100_000_000),
    }).strict()).min(1).max(100),
    notes: z.string().max(4000).optional(),
  }).strict(),
}).strict()

export type ParsedInvoice = {
  clientName: string
  jobAddress?: string | null
  tradeType: TradeType
  jobTitle: string
  jobDescription: string
  laborHours: number
  laborRate: number
  lineItems: { id?: string; description: string; quantity: number; unitPrice: number; total: number; type: 'labor' | 'material' }[]
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  notes?: string | null
  paymentTerms: 'Due on receipt' | 'Net 14' | 'Net 30'
}

type Options = {
  deadlineMs?: number
  fetcher?: typeof fetch
  functionUrl: string
  getAccessToken: () => Promise<string | null>
  hasConsent: () => boolean
}

const validateUrl = (value: string): string => {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    !url.pathname.endsWith('/functions/v1/fieldcraft-ai') || /groq/i.test(url.hostname)
  ) {
    throw new Error('FieldCraft AI function URL is invalid.')
  }
  return url.toString()
}

const readBoundedText = async (response: Response): Promise<string> => {
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('FieldCraft AI returned an invalid response.')
      }
      chunks.push(value)
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(body)
  }
  const body = await response.text()
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('FieldCraft AI returned an invalid response.')
  }
  return body
}

const parseResponse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error('FieldCraft AI returned an invalid response.')
  return parsed.data
}

export const createFieldCraftAiClient = (options: Options) => {
  const functionUrl = validateUrl(options.functionUrl)
  const fetcher = options.fetcher ?? fetch
  const call = async (payload: Record<string, unknown>): Promise<unknown> => {
    if (!options.hasConsent()) throw new Error('AI consent is required before sending job details.')
    const token = await options.getAccessToken()
    if (!token) throw new Error('Sign in again before using FieldCraft AI.')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.deadlineMs ?? (payload.route === 'invoice.parse.v1' ? 20_000 : 10_000))
    try {
      const result = await fetcher(functionUrl, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      })
      const body = await Promise.race([
        readBoundedText(result),
        new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => {
          reject(new Error('FieldCraft AI timed out. Please try again.'))
        }, { once: true })),
      ])
      if (!result.ok) throw new Error('FieldCraft AI is temporarily unavailable.')
      try { return JSON.parse(body) } catch { throw new Error('FieldCraft AI returned an invalid response.') }
    } catch (cause) {
      if (timedOut) throw new Error('FieldCraft AI timed out. Please try again.')
      throw cause
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async parseJobTranscript(transcript: string, defaults: { tradeType: TradeType; hourlyRateCents: number; taxBasisPoints: number } = { tradeType: 'General', hourlyRateCents: 0, taxBasisPoints: 0 }): Promise<ParsedInvoice> {
      const parsed = parseResponse(InvoiceResponseSchema, await call({ route: 'invoice.parse.v1', consentVersion: AI_CONSENT_VERSION, transcript, defaults })).result
      const lineItems = parsed.lineItems.map((item) => ({
        description: item.description, type: item.type, quantity: item.quantity / 1000,
        unitPrice: item.unitPriceCents / 100, total: Math.round(item.quantity * item.unitPriceCents / 1000) / 100,
      }))
      const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0)
      const taxAmount = Math.round(subtotal * parsed.taxBasisPoints) / 10_000
      return {
        ...parsed, jobDescription: parsed.jobDescription ?? '', laborHours: 0,
        laborRate: defaults.hourlyRateCents / 100, lineItems, subtotal,
        taxRate: parsed.taxBasisPoints / 100, taxAmount, total: subtotal + taxAmount,
      }
    },
    async categorizeExpense(vendor: string, amount: number, notes: string) {
      return parseResponse(ExpenseResponseSchema, await call({ route: 'expense.categorize.v1', consentVersion: AI_CONSENT_VERSION, vendor, amountCents: Math.round(amount * 100), notes })).result
    },
    async draftMessage(context: string, tone: MessageTone) {
      return parseResponse(MessageResponseSchema, await call({ route: 'message.draft.v1', consentVersion: AI_CONSENT_VERSION, tone, context })).result.message
    },
  }
}

const defaultClient = () => createFieldCraftAiClient({
  functionUrl: `${String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '')}/functions/v1/fieldcraft-ai`,
  async getAccessToken() {
    const { data, error } = await supabase.auth.getSession()
    return error ? null : data.session?.access_token ?? null
  },
  hasConsent: () => globalThis.localStorage?.getItem(CONSENT_KEY) === AI_CONSENT_VERSION,
})

export const grantFieldCraftAiConsent = () => globalThis.localStorage?.setItem(CONSENT_KEY, AI_CONSENT_VERSION)
export const revokeFieldCraftAiConsent = () => globalThis.localStorage?.removeItem(CONSENT_KEY)
export const hasFieldCraftAiConsent = () => globalThis.localStorage?.getItem(CONSENT_KEY) === AI_CONSENT_VERSION
export const ensureFieldCraftAiConsent = (): boolean => {
  if (hasFieldCraftAiConsent()) return true
  if (typeof globalThis.confirm !== 'function') return false
  const granted = globalThis.confirm('Allow FieldCraft AI to send only the job details you enter to the configured AI provider? You can revoke access in Settings.')
  if (granted) grantFieldCraftAiConsent()
  return granted
}

const withConsent = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (!ensureFieldCraftAiConsent()) throw new Error('AI consent is required before sending job details.')
  return operation()
}

export const parseJobTranscript = (...args: Parameters<ReturnType<typeof defaultClient>['parseJobTranscript']>) => withConsent(() => defaultClient().parseJobTranscript(...args))
export const categorizeExpense = (...args: Parameters<ReturnType<typeof defaultClient>['categorizeExpense']>) => withConsent(() => defaultClient().categorizeExpense(...args))
export const draftMessage = (...args: Parameters<ReturnType<typeof defaultClient>['draftMessage']>) => withConsent(() => defaultClient().draftMessage(...args))
