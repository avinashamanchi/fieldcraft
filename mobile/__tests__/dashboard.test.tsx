import { fireEvent, render, screen } from '@testing-library/react-native'

import { DashboardView, type DashboardMetrics } from '../app/(tabs)/index'
import type { Job } from '../src/domain/entities'

const metrics: DashboardMetrics = {
  outstandingCents: 125_050,
  jobsThisMonth: 4,
  paidCents: 220_000,
  expenseCents: 45_000,
  estimatedProfitCents: 175_000,
  overdueCount: 2,
}

const recentJobs: Job[] = [{
  id: 'job-1', ownerId: 'owner-a', clientId: 'client-1', title: 'Water heater replacement',
  status: 'In Progress', version: 2, createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z', syncState: 'current',
}]

it('shows validated business metrics, recent jobs, and careful estimate labels', () => {
  render(<DashboardView metrics={metrics} recentJobs={recentJobs} />)

  expect(screen.getByText('$1,250.50')).toBeTruthy()
  expect(screen.getByText('4')).toBeTruthy()
  expect(screen.getByText('$2,200.00')).toBeTruthy()
  expect(screen.getByText('$450.00')).toBeTruthy()
  expect(screen.getByText('$1,750.00')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByText('Water heater replacement')).toBeTruthy()
  expect(screen.getByText(/estimates only—not tax or accounting advice/i)).toBeTruthy()
})

it('keeps voice and manual job entry in one dashboard action', () => {
  const onLogJob = jest.fn()
  render(<DashboardView metrics={metrics} recentJobs={recentJobs} onLogJob={onLogJob} />)

  fireEvent.press(screen.getByTestId('log-job'))
  expect(onLogJob).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/speak or type/i)).toBeTruthy()
})

it('stacks dashboard metrics at 200% Dynamic Type and disables decorative transforms', () => {
  render(
    <DashboardView
      fontScale={2}
      metrics={metrics}
      recentJobs={recentJobs}
      reduceMotion
    />,
  )

  expect(screen.getByTestId('dashboard-stats').props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ flexDirection: 'column' })]),
  )
  expect(screen.getByTestId('job-docket-accent').props.style).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ transform: expect.anything() })]),
  )
})
