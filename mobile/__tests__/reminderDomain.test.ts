type ReminderModule = {
  buildReminderOccurrenceKey: (invoiceId: string, scheduleId: string, occurrence: string) => string
  shouldCancelScheduledReminder: (input: {
    invoiceStatus: string
    balanceCents: number
    recipientEmail?: string
    isPro: boolean
    scheduleActive: boolean
    hasReminderConsent: boolean
  }) => boolean
  recordManualReminderShare: () => { status: string }
}

const loadReminders = (): ReminderModule | null => {
  try {
    return require('../src/domain/reminders') as ReminderModule
  } catch {
    return null
  }
}

it('builds stable reminder occurrence keys and rejects unsupported occurrences', () => {
  const reminders = loadReminders()
  expect(reminders).not.toBeNull()
  if (!reminders) return

  expect(reminders.buildReminderOccurrenceKey('invoice-a', 'schedule-a', 'due'))
    .toBe('invoice-a:schedule-a:due')
  expect(reminders.buildReminderOccurrenceKey('invoice-a', 'schedule-a', 'due'))
    .toBe('invoice-a:schedule-a:due')
  expect(() => reminders.buildReminderOccurrenceKey('invoice-a', 'schedule-a', 'tomorrow'))
    .toThrow('INVALID_REMINDER_OCCURRENCE')
})

it('cancels an unsent scheduled reminder when any authoritative eligibility check fails', () => {
  const reminders = loadReminders()
  expect(reminders).not.toBeNull()
  if (!reminders) return

  const eligible = {
    invoiceStatus: 'Issued',
    balanceCents: 10_000,
    recipientEmail: 'synthetic@example.test',
    isPro: true,
    scheduleActive: true,
    hasReminderConsent: true,
  }
  expect(reminders.shouldCancelScheduledReminder(eligible)).toBe(false)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, invoiceStatus: 'Paid' })).toBe(true)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, balanceCents: 0 })).toBe(true)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, recipientEmail: undefined })).toBe(true)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, isPro: false })).toBe(true)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, scheduleActive: false })).toBe(true)
  expect(reminders.shouldCancelScheduledReminder({ ...eligible, hasReminderConsent: false })).toBe(true)
})

it('records opening the share sheet without claiming delivery', () => {
  const reminders = loadReminders()
  expect(reminders).not.toBeNull()
  if (!reminders) return

  expect(reminders.recordManualReminderShare()).toEqual({ status: 'Share sheet opened' })
})
