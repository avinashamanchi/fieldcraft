import { Share } from 'react-native'

import { MAX_MONEY_CENTS } from '../../domain/limits'
import { recordManualReminderShare } from '../../domain/reminders'

export type ManualReminderInput = Readonly<{
  businessName: string
  clientName: string
  invoiceNumber: string
  balanceCents: number
  dueAt: string
}>

const money = (cents: number): string => `$${(cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`

export const buildManualReminder = (input: ManualReminderInput): string => {
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 1 || input.balanceCents > MAX_MONEY_CENTS) {
    throw new Error('INVALID_REMINDER_BALANCE')
  }
  const due = new Date(input.dueAt)
  if (Number.isNaN(due.getTime())) throw new Error('INVALID_REMINDER_DUE_DATE')
  const required = [input.businessName, input.clientName, input.invoiceNumber].map((value) => value.trim())
  if (required.some((value) => (
    value.length === 0 || value.includes('\u0000') ||
    /[\uD800-\uDFFF]/u.test(value.normalize('NFC').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ''))
  ))) throw new Error('INVALID_REMINDER_DETAILS')
  const dueDate = due.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  return `Hi ${required[1]}, this is a reminder from ${required[0]} that invoice ${required[2]} has a balance of ${money(input.balanceCents)}, due ${dueDate}. Please contact us if you have questions.`
}

type SharePort = Pick<typeof Share, 'share'>
let inFlight: { message: string; promise: Promise<Readonly<{ status: 'Share sheet opened' }>> } | null = null

export const shareManualReminder = (
  message: string,
  port: SharePort = Share,
): Promise<Readonly<{ status: 'Share sheet opened' }>> => {
  const clean = message.trim()
  if (!clean || Array.from(clean).length > 4_000) {
    return Promise.reject(new Error('INVALID_REMINDER_MESSAGE'))
  }
  if (inFlight) {
    return inFlight.message === clean
      ? inFlight.promise
      : Promise.reject(new Error('REMINDER_SHARE_IN_PROGRESS'))
  }
  const pending = port.share({ message: clean, title: 'Invoice reminder' })
    .then(() => recordManualReminderShare())
  inFlight = { message: clean, promise: pending }
  void pending.finally(() => {
    if (inFlight?.promise === pending) inFlight = null
  }).catch(() => {})
  return pending
}
