import { useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'

import { PrimaryButton } from '../../../src/components/PrimaryButton'
import { Screen } from '../../../src/components/Screen'
import { useFieldCraftData } from '../../../src/data/DataProvider'
import type { Client, Invoice, Payment, UserProfile } from '../../../src/domain/entities'
import { calculatePaymentSummary } from '../../../src/domain/payments'
import { buildManualReminder, shareManualReminder } from '../../../src/features/reminders/reminderService'
import { listInvoicePaymentsPaged } from '../../../src/features/payments/paymentCommands'
import { colors, spacing, typography } from '../../../src/theme/tokens'

type ReminderDetail = { invoice: Invoice; client: Client; profile: UserProfile | null; payments: Payment[] }

export default function InvoiceRemindersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const [detail, setDetail] = useState<ReminderDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      const invoice = await repository.get<Invoice>('invoice', id)
      if (!invoice) throw new Error('Invoice unavailable')
      const [client, profile, payments] = await Promise.all([
        repository.get<Client>('client', invoice.clientId),
        owner.ownerId ? repository.get<UserProfile>('profile', owner.ownerId) : Promise.resolve(null),
        listInvoicePaymentsPaged(repository, id, () => repository.ownerBoundary.getSnapshot().ownerId),
      ])
      if (!client) throw new Error('Client unavailable')
      if (active) setDetail({ invoice, client, profile, payments })
    })().catch(() => { if (active) setError('The reminder could not be prepared from local data.') })
    return () => { active = false }
  }, [id, owner.ownerId, repository])
  const share = (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = (async () => {
      if (!detail) return
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const summary = calculatePaymentSummary(detail.invoice.totalCents, detail.payments.map((payment) => ({
          amountCents: payment.amountCents, currency: payment.currency,
          status: payment.status, refundedCents: payment.refundedCents,
        })))
        const message = buildManualReminder({
          businessName: detail.profile?.businessName ?? 'FieldCraft business',
          clientName: detail.client.name,
          invoiceNumber: detail.invoice.number ?? detail.invoice.id,
          balanceCents: summary.balanceCents,
          dueAt: detail.invoice.dueAt ?? detail.invoice.issuedAt ?? detail.invoice.createdAt,
        })
        const result = await shareManualReminder(message)
        setNotice(result.status)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The share sheet could not be opened.')
      } finally { setBusy(false) }
    })()
    inFlight.current = pending
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null })
    return pending
  }
  if (!detail) return <Screen><ActivityIndicator color={colors.orange} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</Screen>
  return (
    <Screen contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.heading}>Manual reminder</Text>
      <Text style={styles.copy}>FieldCraft prepares reviewed text and opens the iOS share sheet. It cannot verify whether a message is delivered.</Text>
      <PrimaryButton disabled={busy} label={busy ? 'Opening…' : 'Review and open share sheet'} onPress={() => { void share() }} testID="share-manual-reminder" />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  notice: { color: colors.success, fontFamily: typography.body, fontSize: 15 },
  screen: { gap: spacing.lg },
})
