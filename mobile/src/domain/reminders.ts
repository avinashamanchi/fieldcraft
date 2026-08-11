export type ReminderOccurrence = 'three-days-before' | 'due' | 'seven-days-overdue'
export type ReminderDeliveryStatus =
  | 'Pending'
  | 'Claimed'
  | 'Accepted by provider'
  | 'Delivered'
  | 'Bounced'
  | 'Cancelled'

const OCCURRENCES = new Set<ReminderOccurrence>([
  'three-days-before',
  'due',
  'seven-days-overdue',
])

const requireKeyPart = (value: string): string => {
  if (!value || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('INVALID_REMINDER_KEY')
  }
  return value
}

export const buildReminderOccurrenceKey = (
  invoiceId: string,
  scheduleId: string,
  occurrence: ReminderOccurrence,
): string => {
  if (!OCCURRENCES.has(occurrence)) throw new Error('INVALID_REMINDER_OCCURRENCE')
  return `${requireKeyPart(invoiceId)}:${requireKeyPart(scheduleId)}:${occurrence}`
}

export const shouldCancelScheduledReminder = (input: Readonly<{
  invoiceStatus: string
  balanceCents: number
  recipientEmail?: string
  isPro: boolean
  scheduleActive: boolean
  hasReminderConsent: boolean
}>): boolean => {
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents <= 0) return true
  if (!['Issued', 'Viewed', 'Partially Paid', 'Overdue'].includes(input.invoiceStatus)) return true
  if (!input.recipientEmail?.trim()) return true
  return !input.isPro || !input.scheduleActive || !input.hasReminderConsent
}

export const recordManualReminderShare = (): Readonly<{ status: 'Share sheet opened' }> =>
  Object.freeze({ status: 'Share sheet opened' })
