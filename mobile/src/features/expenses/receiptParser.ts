import type { ExpenseCategory } from '../../domain/entities'
import type { ReceiptOcrResult } from '../../native/vision'

export type ExpenseDraft = {
  vendor: string
  amountCents: number
  category: ExpenseCategory
  expenseDate: string
  notes: string
  jobId?: string
  clientId?: string
}

export type ParsedReceipt = ExpenseDraft & { confidence: number; manualReviewRequired: boolean }

const amountFrom = (value: string): number | null => {
  const matches = [...value.matchAll(/(?:\$\s*)?(-?\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))\b/g)]
  const match = matches.at(-1)
  if (!match) return null
  const whole = Number(match[1].replace(/,/g, ''))
  const cents = Number(match[2] ?? '00')
  const result = whole * 100 + Math.sign(whole || 1) * cents
  return Number.isSafeInteger(result) && result >= 0 && result <= 100_000_000 ? result : null
}

const dateFrom = (value: string): string | null => {
  const iso = value.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  const us = value.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/)
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : us ? [Number(us[3]), Number(us[1]), Number(us[2])] : null
  if (!parts) return null
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export const parseReceipt = (ocr: ReceiptOcrResult): ParsedReceipt => {
  const lines = (ocr.observations.length > 0 ? ocr.observations.map((item) => item.text) : ocr.text.split(/\r?\n/))
    .map((line) => line.trim()).filter(Boolean)
  const vendor = lines.find((line) => !dateFrom(line) && amountFrom(line) === null && !/receipt|invoice|thank you|total|tax|subtotal/i.test(line)) ?? ''
  const labeled = lines
    .filter((line) => /\b(grand\s+total|amount\s+due|total)\b/i.test(line) && !/subtotal|tax|change/i.test(line))
    .map((line) => ({ line, amount: amountFrom(line), priority: /grand\s+total|amount\s+due/i.test(line) ? 2 : 1 }))
    .filter((candidate): candidate is { line: string; amount: number; priority: number } => candidate.amount !== null)
    .sort((left, right) => right.priority - left.priority)
  const allAmounts = lines.map(amountFrom).filter((amount): amount is number => amount !== null)
  const amountCents = labeled[0]?.amount ?? (allAmounts.length ? Math.max(...allAmounts) : 0)
  const expenseDate = lines.map(dateFrom).find((date): date is string => date !== null) ?? ''
  const manualReviewRequired = ocr.confidence < 0.75 || !vendor || amountCents === 0 || !expenseDate
  return { vendor, amountCents, category: 'Other', expenseDate, notes: '', confidence: ocr.confidence, manualReviewRequired }
}
