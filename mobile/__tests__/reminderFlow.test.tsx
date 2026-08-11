import { buildManualReminder, shareManualReminder } from '../src/features/reminders/reminderService'

it('opens a native share sheet with truthful copy and never claims delivery', async () => {
  const message = buildManualReminder({
    businessName: 'FieldCraft Plumbing', clientName: 'Mina', invoiceNumber: 'INV-42',
    balanceCents: 7_500, dueAt: '2026-08-20T20:00:00.000Z',
  })
  expect(message).toContain('$75.00')
  expect(message).not.toMatch(/delivered|sent successfully/i)

  const share = jest.fn(async () => ({ action: 'sharedAction' as const }))
  await expect(shareManualReminder(message, { share })).resolves.toEqual({ status: 'Share sheet opened' })
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ message }))
})
it('rejects invalid balances and suppresses duplicate in-flight shares', async () => {
  expect(() => buildManualReminder({
    businessName: 'FieldCraft', clientName: 'Mina', invoiceNumber: 'INV-1',
    balanceCents: -1, dueAt: '2026-08-20T20:00:00.000Z',
  })).toThrow('INVALID_REMINDER_BALANCE')

  let finish!: () => void
  const share = jest.fn(() => new Promise<{ action: 'sharedAction' }>((resolve) => {
    finish = () => resolve({ action: 'sharedAction' })
  }))
  const first = shareManualReminder('Reminder', { share })
  const second = shareManualReminder('Reminder', { share })
  expect(share).toHaveBeenCalledTimes(1)
  finish()
  await expect(Promise.all([first, second])).resolves.toEqual([
    { status: 'Share sheet opened' }, { status: 'Share sheet opened' },
  ])
})
