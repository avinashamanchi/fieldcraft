import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { createRef } from 'react'
import { Dimensions, StyleSheet } from 'react-native'

import { DashboardView, type DashboardMetrics } from '../app/(tabs)/index'
import { DeleteAccountControl } from '../app/settings/delete-account'
import { ConfirmRecordDeleteSheet } from '../src/components/ConfirmRecordDeleteSheet'
import { InvoiceEditor } from '../src/features/invoices/InvoiceEditor'
import { VirtualizedEntityList } from '../src/components/VirtualizedEntityList'
import { MIN_TOUCH_TARGET } from '../src/theme/tokens'

const metrics: DashboardMetrics = { outstandingCents: 0, jobsThisMonth: 0, paidCents: 0, expenseCents: 0, estimatedProfitCents: 0, overdueCount: 0 }
const draft = {
  clientName: 'Jordan', jobTitle: 'Replace valve', tradeType: 'Plumbing' as const, taxBasisPoints: 0,
  paymentTerms: 'Due on receipt' as const,
  lineItems: [{ description: 'Valve', type: 'material' as const, quantity: 1_000, unitPriceCents: 2_500 }],
}

beforeAll(() => {
  const viewport = { width: 320, height: 568, scale: 2, fontScale: 2 }
  Dimensions.set({ window: viewport, screen: viewport })
})

it('keeps the 320-point dashboard scrollable, stacked, labeled, and motion-safe at 200% text', () => {
  render(<DashboardView fontScale={2} metrics={metrics} recentJobs={[]} reduceMotion />)
  expect(screen.getByTestId('dashboard-scroll')).toBeTruthy()
  expect(screen.getByTestId('dashboard-stats').props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexDirection: 'column' })]))
  expect(screen.getByRole('button', { name: /log a job/i })).toBeTruthy()
  expect(screen.getByTestId('job-docket-accent').props.style).not.toEqual(expect.arrayContaining([expect.objectContaining({ transform: expect.anything() })]))
})

it('keeps invoice primary controls reachable, labeled, and at least 48 points tall', () => {
  render(<InvoiceEditor continueTestID="save-invoice" draft={draft} onChange={() => {}} onContinue={() => {}} />)
  expect(screen.getByLabelText('Client name')).toBeTruthy()
  expect(screen.getByLabelText('Unit price ($)')).toBeTruthy()
  const save = screen.getByTestId('save-invoice')
  expect(save.props.accessibilityState).toEqual({ disabled: false })
  expect(StyleSheet.flatten(save.props.style).minHeight).toBe(MIN_TOUCH_TARGET)
  expect(screen.queryByRole('alert')).toBeNull()
})

it('uses virtualization for long primary record lists', () => {
  const data = Array.from({ length: 100 }, (_, index) => ({ id: String(index) }))
  render(<VirtualizedEntityList data={data} emptyMessage="None" renderItem={() => null} />)
  const list = screen.getByTestId('virtualized-entity-list')
  expect(list.props.initialNumToRender).toBe(20)
  expect(list.props.windowSize).toBe(7)
})

it('announces destructive errors and restores focus after a delete sheet closes', async () => {
  const returnFocusRef = createRef<{ focus?: () => void }>()
  returnFocusRef.current = { focus: jest.fn() }
  const view = render(<ConfirmRecordDeleteSheet linkedCount={0} onCancel={() => {}} onConfirm={() => {}} recordLabel="job" returnFocusRef={returnFocusRef} visible />)
  expect(screen.getByRole('header', { name: 'Delete job?' })).toBeTruthy()
  view.rerender(<ConfirmRecordDeleteSheet linkedCount={0} onCancel={() => {}} onConfirm={() => {}} recordLabel="job" returnFocusRef={returnFocusRef} visible={false} />)
  expect(returnFocusRef.current.focus).toHaveBeenCalledTimes(1)

  render(<DeleteAccountControl deleteCloud={async () => { throw new Error('offline') }} deleteLocal={async () => ({ ok: true })} />)
  fireEvent.changeText(screen.getByTestId('delete-account-phrase'), 'DELETE MY ACCOUNT')
  await act(async () => { fireEvent.press(screen.getByTestId('confirm-delete-account')) })
  expect(await screen.findByRole('alert')).toHaveTextContent(/not deleted/i)
})
