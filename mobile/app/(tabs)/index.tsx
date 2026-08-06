import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'

import { ErrorState } from '../../src/components/ErrorState'
import { JobRow } from '../../src/components/JobRow'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { StatCard } from '../../src/components/StatCard'
import { SyncStatusBanner } from '../../src/components/SyncStatusBanner'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { useSyncStatus } from '../../src/data/SyncProvider'
import type { Expense, Invoice, Job } from '../../src/domain/entities'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

export type DashboardMetrics = {
  outstandingCents: number
  jobsThisMonth: number
  paidCents: number
  expenseCents: number
  estimatedProfitCents: number
  overdueCount: number
}

const ZERO_METRICS: DashboardMetrics = {
  outstandingCents: 0,
  jobsThisMonth: 0,
  paidCents: 0,
  expenseCents: 0,
  estimatedProfitCents: 0,
  overdueCount: 0,
}

const formatCents = (cents: number): string => {
  const absolute = Math.abs(cents)
  const formatted = `$${Math.floor(absolute / 100).toLocaleString('en-US')}.${String(absolute % 100).padStart(2, '0')}`
  return cents < 0 ? `-${formatted}` : formatted
}

export const calculateDashboardMetrics = (
  jobs: Job[],
  invoices: Invoice[],
  expenses: Expense[],
  now = new Date(),
): DashboardMetrics => {
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const paidCents = invoices.reduce((sum, invoice) => (
    invoice.jobId && jobsById.get(invoice.jobId)?.status === 'Paid' ? sum + invoice.totalCents : sum
  ), 0)
  const outstandingCents = invoices.reduce((sum, invoice) => (
    invoice.jobId && jobsById.get(invoice.jobId)?.status === 'Paid' ? sum : sum + invoice.totalCents
  ), 0)
  const expenseCents = expenses.reduce((sum, expense) => sum + expense.amountCents, 0)
  const jobsThisMonth = jobs.filter((job) => {
    const created = new Date(job.createdAt)
    return created.getUTCFullYear() === now.getUTCFullYear() && created.getUTCMonth() === now.getUTCMonth()
  }).length
  const overdueBoundary = now.getTime() - 30 * 24 * 60 * 60 * 1000
  const overdueCount = jobs.filter((job) => (
    job.status === 'Invoiced' && new Date(job.updatedAt).getTime() < overdueBoundary
  )).length
  return {
    outstandingCents,
    jobsThisMonth,
    paidCents,
    expenseCents,
    estimatedProfitCents: paidCents - expenseCents,
    overdueCount,
  }
}

type DashboardViewProps = {
  fontScale?: number
  metrics: DashboardMetrics
  onLogJob?: () => void
  recentJobs: Job[]
  reduceMotion?: boolean
}

export const DashboardView = ({
  fontScale: suppliedFontScale,
  metrics,
  onLogJob,
  recentJobs,
  reduceMotion: suppliedReduceMotion,
}: DashboardViewProps) => {
  const { fontScale: systemFontScale } = useWindowDimensions()
  const [systemReduceMotion, setSystemReduceMotion] = useState(false)
  useEffect(() => {
    let current = true
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (current) setSystemReduceMotion(enabled)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduceMotion)
    return () => {
      current = false
      subscription.remove()
    }
  }, [])
  const fontScale = suppliedFontScale ?? systemFontScale
  const reduceMotion = suppliedReduceMotion ?? systemReduceMotion
  const stacked = fontScale >= 1.5

  return (
    <Screen scroll testID="dashboard-scroll">
      <View style={styles.eyebrowRow}>
        <Text style={styles.eyebrow}>FIELD DOCKET</Text>
        <Text style={styles.date}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
      </View>
      <Text accessibilityRole="header" style={styles.heading}>Work that needs your hands.</Text>

      <View style={styles.docket}>
        <View
          style={[styles.docketAccent, !reduceMotion && styles.docketAccentMotion]}
          testID="job-docket-accent"
        />
        <View style={styles.docketCopy}>
          <Text style={styles.docketTitle}>Log the next job</Text>
          <Text style={styles.docketBody}>Speak or type the details. You can review everything before saving.</Text>
        </View>
        <PrimaryButton
          accessibilityLabel="Log a job by voice or typing"
          label="Log job"
          onPress={onLogJob}
          testID="log-job"
        />
      </View>

      <Text style={styles.sectionTitle}>Business snapshot</Text>
      <View
        style={[styles.stats, { flexDirection: stacked ? 'column' : 'row' }]}
        testID="dashboard-stats"
      >
        <StatCard label="Outstanding" value={formatCents(metrics.outstandingCents)} />
        <StatCard label="Jobs this month" value={String(metrics.jobsThisMonth)} />
      </View>
      <View style={[styles.stats, { flexDirection: stacked ? 'column' : 'row' }]}>
        <StatCard label="Paid" value={formatCents(metrics.paidCents)} />
        <StatCard label="Expenses" value={formatCents(metrics.expenseCents)} />
      </View>
      <View style={[styles.stats, { flexDirection: stacked ? 'column' : 'row' }]}>
        <StatCard label="Estimated profit" value={formatCents(metrics.estimatedProfitCents)} />
        <StatCard label="Overdue" value={String(metrics.overdueCount)} warning={metrics.overdueCount > 0} />
      </View>
      <Text style={styles.disclaimer}>Estimated profit and overdue counts are planning estimates only—not tax or accounting advice.</Text>

      <Text style={styles.sectionTitle}>Recent jobs</Text>
      {recentJobs.length === 0 ? (
        <Text style={styles.emptyCopy}>No jobs yet. Log your first job from the field docket above.</Text>
      ) : recentJobs.map((job) => <JobRow job={job} key={job.id} />)}
    </Screen>
  )
}

const ConnectedDashboard = () => {
  const { repository, initializationError } = useFieldCraftData()
  const syncStatus = useSyncStatus()
  const [metrics, setMetrics] = useState(ZERO_METRICS)
  const [recentJobs, setRecentJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<Error | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [jobs, invoices, expenses] = await Promise.all([
        repository.list<Job>('job'),
        repository.list<Invoice>('invoice'),
        repository.list<Expense>('expense'),
      ])
      setMetrics(calculateDashboardMetrics(jobs, invoices, expenses))
      setRecentJobs([...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5))
    } catch (error) {
      setLoadError(error instanceof Error ? error : new Error(String(error)))
    } finally {
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    void load()
    return repository.subscribeToLocalMutations(() => { void load() })
  }, [load, repository])

  const error = initializationError ?? loadError
  if (error) return <Screen><ErrorState message={error.message} onRetry={() => { void load() }} /></Screen>
  if (loading) {
    return <Screen><View accessibilityLabel="Loading dashboard" style={styles.loading}><ActivityIndicator color={colors.orange} /></View></Screen>
  }
  return (
    <>
      <SyncStatusBanner status={syncStatus} />
      <DashboardView
        metrics={metrics}
        onLogJob={() => router.push('/jobs/new' as never)}
        recentJobs={recentJobs}
      />
    </>
  )
}

export default function DashboardScreen() {
  return <ConnectedDashboard />
}

const styles = StyleSheet.create({
  date: { color: colors.muted, fontFamily: typography.utility, fontSize: 12 },
  disclaimer: { color: colors.muted, fontFamily: typography.body, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  docket: { backgroundColor: colors.panel, borderRadius: radius.lg, gap: spacing.lg, overflow: 'hidden', padding: spacing.lg },
  docketAccent: { backgroundColor: colors.orange, height: 5, left: 0, position: 'absolute', right: 0, top: 0 },
  docketAccentMotion: { transform: [{ translateX: 0 }] },
  docketBody: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  docketCopy: { gap: spacing.sm },
  docketTitle: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 26, fontWeight: '800' },
  emptyCopy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  eyebrowRow: { flexDirection: 'row', justifyContent: 'space-between' },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 36, fontWeight: '800', lineHeight: 40, marginBottom: spacing.xl, marginTop: spacing.sm },
  loading: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  sectionTitle: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 20, fontWeight: '800', marginBottom: spacing.md, marginTop: spacing.xxl },
  stats: { gap: spacing.md, marginBottom: spacing.md },
})
