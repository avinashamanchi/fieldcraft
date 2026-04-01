import { z } from 'zod'
import { INVOICE_PARSE_SYSTEM_PROMPT, EXPENSE_CATEGORIZE_SYSTEM_PROMPT, MESSAGE_DRAFT_SYSTEM_PROMPT } from '../constants/prompts'
import type { MessageTone } from '../types'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY as string
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/chat/completions'

async function callGroq(systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch(GROQ_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`GROQ API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  return data.choices[0]?.message?.content ?? ''
}

const LineItemSchema = z.object({
  id: z.string().optional(),
  description: z.string(),
  quantity: z.number(),
  unitPrice: z.number(),
  total: z.number(),
  type: z.enum(['labor', 'material']),
})

const InvoiceParseSchema = z.object({
  clientName: z.string(),
  jobAddress: z.string().nullable().optional(),
  tradeType: z.enum(['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']),
  jobTitle: z.string(),
  jobDescription: z.string(),
  laborHours: z.number(),
  laborRate: z.number(),
  lineItems: z.array(LineItemSchema),
  subtotal: z.number(),
  taxRate: z.number(),
  taxAmount: z.number(),
  total: z.number(),
  notes: z.string().nullable().optional(),
  paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
})

export type ParsedInvoice = z.infer<typeof InvoiceParseSchema>

function extractJSON(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()

  // Find first { and last }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) return text.slice(start, end + 1)

  return text.trim()
}

export async function parseJobTranscript(transcript: string): Promise<ParsedInvoice> {
  let raw = await callGroq(INVOICE_PARSE_SYSTEM_PROMPT, transcript)
  let jsonStr = extractJSON(raw)

  let parsed = InvoiceParseSchema.safeParse(JSON.parse(jsonStr))

  if (!parsed.success) {
    // Retry with stricter prompt
    const strictPrompt = INVOICE_PARSE_SYSTEM_PROMPT + '\n\nIMPORTANT: Return ONLY the raw JSON object. No markdown. No explanation. Start with { and end with }.'
    raw = await callGroq(strictPrompt, transcript)
    jsonStr = extractJSON(raw)
    parsed = InvoiceParseSchema.safeParse(JSON.parse(jsonStr))

    if (!parsed.success) {
      throw new Error("Couldn't parse that job — try describing it again more specifically.")
    }
  }

  return parsed.data
}

const ExpenseCategorySchema = z.object({
  category: z.enum(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other']),
  suggestedJobId: z.string().nullable().optional(),
})

export async function categorizeExpense(vendor: string, amount: number, notes: string): Promise<z.infer<typeof ExpenseCategorySchema>> {
  const userMsg = `Vendor: ${vendor}\nAmount: $${amount}\nNotes: ${notes}`
  const raw = await callGroq(EXPENSE_CATEGORIZE_SYSTEM_PROMPT, userMsg)
  const jsonStr = extractJSON(raw)
  const parsed = ExpenseCategorySchema.safeParse(JSON.parse(jsonStr))
  if (!parsed.success) return { category: 'Other', suggestedJobId: null }
  return parsed.data
}

export async function draftMessage(context: string, tone: MessageTone): Promise<string> {
  const userMsg = `Tone: ${tone}\n\nWhat I want to communicate: ${context}`
  return callGroq(MESSAGE_DRAFT_SYSTEM_PROMPT, userMsg)
}
