import { router, useLocalSearchParams } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { ErrorState } from '../../src/components/ErrorState'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client, Invoice, Job, Payment } from '../../src/domain/entities'
import { calculateInvoice } from '../../src/domain/invoice'
import { InvoiceSummary } from '../../src/features/invoices/InvoiceSummary'
import { buildIssueInvoiceMutation } from '../../src/features/invoices/saveInvoiceBundle'
import { PaymentHistory } from '../../src/features/payments/PaymentHistory'
import { listInvoicePaymentsPaged } from '../../src/features/payments/paymentCommands'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

type Detail = { invoice: Invoice; client: Client | null; job: Job | null; payments: Payment[] }

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { repository } = useFieldCraftData()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const load = useCallback(async () => {
      const invoice = await repository.get<Invoice>('invoice', id)
      if (!invoice) { setMissing(true); return }
      const [client, job, payments] = await Promise.all([
        repository.get<Client>('client', invoice.clientId),
        invoice.jobId ? repository.get<Job>('job', invoice.jobId) : Promise.resolve(null),
        listInvoicePaymentsPaged(repository, id, () => repository.ownerBoundary.getSnapshot().ownerId),
      ])
      setDetail({ invoice, client, job, payments })
  }, [id, repository])
  useEffect(() => {
    let active = true
    const guardedLoad = async () => {
      try { await load() }
      catch { if (active) setError('The invoice could not be loaded securely from this device.') }
    }
    void guardedLoad()
    const unsubscribe = repository.subscribeToLocalMutations(() => { void guardedLoad() })
    return () => { active = false; unsubscribe() }
  }, [load, repository])
  const issue = (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = (async () => {
      if (!detail) return
      setBusy(true)
      setError(null)
      try {
        await repository.transactLocalMutation(buildIssueInvoiceMutation({
          invoice: detail.invoice,
          mutationId: Crypto.randomUUID(),
          issuedAt: new Date().toISOString(),
        }))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The invoice could not be issued locally.')
      } finally { setBusy(false) }
    })()
    inFlight.current = pending
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null })
    return pending
  }
  if (missing) return <Screen><ErrorState message="This invoice is no longer available." /></Screen>
  if (!detail) return <Screen><ActivityIndicator color={colors.orange} />{error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><PrimaryButton label="Try again" onPress={() => { void load() }} /></> : null}</Screen>
  const calculated = calculateInvoice(detail.invoice.draft)
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>INVOICE · {detail.invoice.syncState.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={styles.heading}>{detail.job?.title ?? detail.invoice.draft.jobTitle}</Text>
      <Text style={styles.client}>{detail.client?.name ?? detail.invoice.draft.clientName}</Text>
      <View style={styles.card}>
        {calculated.lineItems.map((line, index) => (
          <View key={line.id ?? `${line.description}-${index}`} style={styles.line}>
            <Text style={styles.lineDescription}>{line.description}</Text>
            <Text style={styles.lineAmount}>${(Math.round(line.quantity * line.unitPriceCents / 1000) / 100).toFixed(2)}</Text>
          </View>
        ))}
      </View>
      <InvoiceSummary invoice={calculated} />
      <PaymentHistory invoice={detail.invoice} payments={detail.payments} />
      {(detail.invoice.status ?? 'Draft') === 'Draft' ? <PrimaryButton disabled={busy} label={busy ? 'Issuing…' : 'Issue invoice'} onPress={() => { void issue() }} testID="issue-invoice" /> : null}
      {['Issued', 'Viewed', 'Partially Paid'].includes(detail.invoice.status ?? '') ? <>
        <PrimaryButton label="Record manual payment" onPress={() => router.push(`/invoices/${detail.invoice.id}/record-payment` as never)} />
        <PrimaryButton label="Create customer payment link" onPress={() => router.push(`/invoices/${detail.invoice.id}/payment-link` as never)} />
        <PrimaryButton label="Prepare manual reminder" onPress={() => router.push(`/invoices/${detail.invoice.id}/reminders` as never)} />
      </> : null}
      <PrimaryButton label="Create PDF to share" onPress={() => router.push(`/invoices/${detail.invoice.id}/share` as never)} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Text style={styles.copy}>{detail.invoice.draft.paymentTerms}</Text>
      {detail.invoice.draft.notes ? <Text style={styles.copy}>{detail.invoice.draft.notes}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  client: { color: colors.muted, fontFamily: typography.body, fontSize: 18 },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  line: { flexDirection: 'row', justifyContent: 'space-between' },
  lineAmount: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 14 },
  lineDescription: { color: colors.warmWhite, flex: 1, fontFamily: typography.body, fontSize: 15 },
  screen: { gap: spacing.lg },
})
