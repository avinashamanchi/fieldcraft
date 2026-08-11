import { useLocalSearchParams } from 'expo-router'
import * as Crypto from 'expo-crypto'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native'

import { requireRecentAal2 } from '../../../src/auth/requireAal2'
import { useSubscription } from '../../../src/billing/SubscriptionProvider'
import { PrimaryButton } from '../../../src/components/PrimaryButton'
import { Screen } from '../../../src/components/Screen'
import { useFieldCraftData } from '../../../src/data/DataProvider'
import type { Client, Invoice, Payment, ReminderSchedule, UserProfile } from '../../../src/domain/entities'
import { calculatePaymentSummary } from '../../../src/domain/payments'
import { buildManualReminder, buildReminderScheduleMutation, findInvoiceReminderSchedule, shareManualReminder } from '../../../src/features/reminders/reminderService'
import { listInvoicePaymentsPaged } from '../../../src/features/payments/paymentCommands'
import { colors, spacing, typography } from '../../../src/theme/tokens'

type ReminderDetail = { invoice: Invoice; client: Client; profile: UserProfile | null; payments: Payment[]; schedule: ReminderSchedule | null }

export default function InvoiceRemindersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const { entitlement } = useSubscription()
  const [detail, setDetail] = useState<ReminderDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [hasConsent, setHasConsent] = useState(false)
  const inFlight = useRef<Promise<void> | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      const invoice = await repository.get<Invoice>('invoice', id)
      if (!invoice) throw new Error('Invoice unavailable')
      const [client, profile, payments, schedule] = await Promise.all([
        repository.get<Client>('client', invoice.clientId),
        owner.ownerId ? repository.get<UserProfile>('profile', owner.ownerId) : Promise.resolve(null),
        listInvoicePaymentsPaged(repository, id, () => repository.ownerBoundary.getSnapshot().ownerId),
        findInvoiceReminderSchedule(repository, id, () => repository.ownerBoundary.getSnapshot().ownerId),
      ])
      if (!client) throw new Error('Client unavailable')
      if (active) {
        setDetail({ invoice, client, profile, payments, schedule })
        setRecipientEmail(schedule?.recipientEmail ?? client.email ?? '')
        setHasConsent(schedule?.hasReminderConsent ?? false)
      }
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
  const schedule = async () => {
    if (!detail || !owner.ownerId) return
    setBusy(true); setError(null); setNotice(null)
    try {
      requireRecentAal2('scheduled-reminder')
      const now = new Date().toISOString()
      const mutation = buildReminderScheduleMutation({
        ownerId: owner.ownerId, invoiceId: detail.invoice.id,
        scheduleId: detail.schedule?.id ?? Crypto.randomUUID(), mutationId: Crypto.randomUUID(),
        recipientEmail, hasReminderConsent: hasConsent, now,
        ...(detail.schedule ? { current: detail.schedule } : {}),
      })
      await repository.transactLocalMutation(mutation)
      setDetail({ ...detail, schedule: mutation.payload as ReminderSchedule })
      setNotice('Scheduled reminders saved. Delivery is rechecked against the live balance and Pro status before each send.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Scheduled reminders could not be saved.') }
    finally { setBusy(false) }
  }
  if (!detail) return <Screen><ActivityIndicator color={colors.orange} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</Screen>
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Manual reminder</Text>
      <Text style={styles.copy}>FieldCraft prepares reviewed text and opens the iOS share sheet. It cannot verify whether a message is delivered.</Text>
      <PrimaryButton disabled={busy} label={busy ? 'Opening…' : 'Review and open share sheet'} onPress={() => { void share() }} testID="share-manual-reminder" />
      <View style={styles.divider} />
      <Text accessibilityRole="header" style={styles.subheading}>Scheduled Pro reminders</Text>
      <Text style={styles.copy}>Send at 3 days before, on the due date, and 7 days overdue. Sending stops if the invoice is paid or void, consent is withdrawn, the email is missing, or Pro is inactive.</Text>
      <TextInput accessibilityLabel="Reminder recipient email" autoCapitalize="none" autoCorrect={false} inputMode="email" onChangeText={setRecipientEmail} placeholder="customer@example.com" placeholderTextColor={colors.muted} style={styles.input} value={recipientEmail} />
      <View style={styles.consentRow}><Text style={styles.copy}>Customer consent to email reminders is recorded</Text><Switch accessibilityLabel="Customer consent recorded" onValueChange={setHasConsent} value={hasConsent} /></View>
      <PrimaryButton disabled={busy || entitlement.state !== 'pro'} label={entitlement.state === 'pro' ? 'Save scheduled reminders' : 'FieldCraft Pro required'} onPress={() => { void schedule() }} />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  consentRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  divider: { backgroundColor: '#444', height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  input: { backgroundColor: colors.panel, borderColor: '#444', borderRadius: 10, borderWidth: 1, color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, minHeight: 48, paddingHorizontal: spacing.md },
  notice: { color: colors.success, fontFamily: typography.body, fontSize: 15 },
  screen: { gap: spacing.lg },
  subheading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 24, fontWeight: '700' },
})
