import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { ExpenseEditor, buildExpenseMutation, suggestExpenseCategory } from '../src/features/expenses/ExpenseEditor'

const draft = { vendor: 'Supply Co', amountCents: 1234, category: 'Other' as const, expenseDate: '2026-08-06', notes: '' }

it('saves an editable expense offline and suppresses duplicate taps', async () => {
  let resolve!: () => void
  const pending = new Promise<void>((done) => { resolve = done })
  const repository = { transactLocalMutation: jest.fn(() => pending) }
  render(<ExpenseEditor initialDraft={draft} jobs={[]} ownerId="owner-a" repository={repository} />)
  fireEvent.press(screen.getByTestId('save-expense'))
  fireEvent.press(screen.getByTestId('save-expense'))
  expect(repository.transactLocalMutation).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(); await pending })
  expect(buildExpenseMutation(draft, { ownerId: 'owner-a', entityId: '00000000-0000-4000-8000-000000000951', mutationId: '00000000-0000-4000-8000-000000000952', now: '2026-08-06T12:00:00.000Z' })).toMatchObject({ kind: 'create', payload: { vendor: 'Supply Co', receiptPath: undefined } })
})

it('sends only minimized reviewed fields for optional categorization and falls back on decline', async () => {
  const request = jest.fn(async (_ownerId: string, _request: Record<string, unknown>) => ({ category: 'Materials' as const }))
  await expect(suggestExpenseCategory({ ...draft, notes: 'x'.repeat(900) }, 'owner-a', { request })).resolves.toBe('Materials')
  expect(request.mock.calls[0][1]).toEqual(expect.objectContaining({ vendor: 'Supply Co', amountCents: 1234, notes: 'x'.repeat(500) }))
  expect(JSON.stringify(request.mock.calls[0][1])).not.toMatch(/image|ocr|receipt/i)
  request.mockRejectedValueOnce({ reason: 'consent-required' })
  await expect(suggestExpenseCategory(draft, 'owner-a', { request })).resolves.toBe('Other')
})
