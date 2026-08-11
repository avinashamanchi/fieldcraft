import { Share } from 'react-native'

import { MAX_MONEY_CENTS } from '../../domain/limits'
import type { ReminderSchedule } from '../../domain/entities'
import { recordManualReminderShare } from '../../domain/reminders'
import type { MutationEnvelope } from '../../domain/sync'
import type { FieldCraftRepository } from '../../data/repository'

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

export const buildReminderScheduleMutation = (input: Readonly<{
  ownerId: string
  invoiceId: string
  scheduleId: string
  mutationId: string
  recipientEmail: string
  hasReminderConsent: boolean
  now: string
  current?: ReminderSchedule
}>): MutationEnvelope => {
  const email = input.recipientEmail.trim().toLowerCase()
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/.test(email) || email.length > 320) throw new Error('INVALID_REMINDER_EMAIL')
  if (!input.hasReminderConsent) throw new Error('REMINDER_CONSENT_REQUIRED')
  if (input.current && (input.current.ownerId !== input.ownerId || input.current.invoiceId !== input.invoiceId || input.current.id !== input.scheduleId)) throw new Error('REMINDER_OWNER_MISMATCH')
  const payload: ReminderSchedule = {
    id: input.scheduleId,
    ownerId: input.ownerId,
    invoiceId: input.invoiceId,
    active: true,
    recipientEmail: email,
    hasReminderConsent: true,
    occurrences: ['three-days-before', 'due', 'seven-days-overdue'],
    version: input.current?.version ?? 0,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
    syncState: 'pending',
  }
  return {
    id: input.mutationId, ownerId: input.ownerId, entity: 'reminder_schedule',
    entityId: input.scheduleId, kind: input.current ? 'update' : 'create',
    baseVersion: input.current?.version ?? null, payload, createdAt: input.now, attempts: 0,
  }
}

export const findInvoiceReminderSchedule = async (
  repository: Pick<FieldCraftRepository, 'listPage'>,
  invoiceId: string,
  currentOwnerId?: () => string | null,
): Promise<ReminderSchedule | null> => {
  const owner = currentOwnerId?.()
  let after: { updatedAt: string; id: string } | null = null
  let scanned = 0
  do {
    if (currentOwnerId && currentOwnerId() !== owner) throw new Error('REMINDER_OWNER_CHANGED')
    const page: { items: ReminderSchedule[]; next: { updatedAt: string; id: string } | null } =
      await repository.listPage<ReminderSchedule>('reminder_schedule', { limit: 50, after })
    scanned += page.items.length
    if (scanned > 10_000) throw new Error('REMINDER_ENTITY_CAP_EXCEEDED')
    const found = page.items.find((schedule) => schedule.invoiceId === invoiceId)
    if (found) return found
    after = page.next
  } while (after !== null)
  return null
}
