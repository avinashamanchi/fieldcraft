import * as Crypto from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { requireRecentAal2, StepUpRequiredError } from '../../../src/auth/requireAal2'
import { FormField } from '../../../src/components/FormField'
import { PrimaryButton } from '../../../src/components/PrimaryButton'
import { Screen } from '../../../src/components/Screen'
import { useFieldCraftData } from '../../../src/data/DataProvider'
import type { Invoice, Payment } from '../../../src/domain/entities'
import { buildManualPaymentMutation, listInvoicePaymentsPaged, type ManualPaymentMethod } from '../../../src/features/payments/paymentCommands'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../../src/theme/tokens'

const METHODS: readonly ManualPaymentMethod[] = ['Cash', 'Check', 'Bank Transfer', 'Other']

export default function RecordPaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { owner, repository } = useFieldCraftData()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<ManualPaymentMethod>('Cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const operation = useRef<ReturnType<typeof buildManualPaymentMutation> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  useEffect(() => {
    let active = true
    void Promise.all([
      repository.get<Invoice>('invoice', id),
      listInvoicePaymentsPaged(repository, id, () => repository.ownerBoundary.getSnapshot().ownerId),
    ]).then(([nextInvoice, nextPayments]) => {
      if (active) { setInvoice(nextInvoice); setPayments(nextPayments) }
    }).catch(() => { if (active) setError('Payment history could not be loaded securely.') })
    return () => { active = false }
  }, [id, repository])
  const save = (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = (async () => {
      if (!invoice || !payments || !owner.ownerId) return
      setBusy(true)
      setError(null)
      try {
        requireRecentAal2('payment-adjustment')
        operation.current ??= buildManualPaymentMutation({
          ownerId: owner.ownerId,
          invoice,
          payments,
          amountCents: Math.round(Number(amount) * 100),
          method,
          note,
          paymentId: Crypto.randomUUID(),
          mutationId: Crypto.randomUUID(),
          recordedAt: new Date().toISOString(),
        })
        await repository.transactLocalMutation(operation.current)
        router.replace(`/invoices/${invoice.id}` as never)
      } catch (cause) {
        if (cause instanceof StepUpRequiredError) {
          router.push('/security/step-up?operation=payment-adjustment' as never)
        } else {
          setError(cause instanceof Error ? cause.message : 'The payment could not be saved locally.')
        }
      } finally { setBusy(false) }
    })()
    inFlight.current = pending
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null })
    return pending
  }
  if (!invoice || !payments) return <Screen><ActivityIndicator color={colors.orange} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</Screen>
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Record manual payment</Text>
      <Text style={styles.copy}>Only record money you independently verified. This does not charge a card or contact the customer.</Text>
      <FormField keyboardType="decimal-pad" label="Amount received ($)" onChangeText={(value) => { operation.current = null; setAmount(value) }} testID="manual-payment-amount" value={amount} />
      <Text style={styles.label}>Method</Text>
      <View style={styles.methods}>{METHODS.map((choice) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: method === choice }} key={choice} onPress={() => { operation.current = null; setMethod(choice) }} style={[styles.method, method === choice && styles.selected]}><Text style={styles.methodText}>{choice}</Text></Pressable>
      ))}</View>
      <FormField label="Internal note (optional)" maxLength={1_000} multiline onChangeText={(value) => { operation.current = null; setNote(value) }} value={note} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={busy || !Number.isFinite(Number(amount)) || Number(amount) <= 0} label={busy ? 'Recording…' : 'Verify and record payment'} onPress={() => { void save() }} testID="record-manual-payment" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  method: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  methodText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14 },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  screen: { gap: spacing.lg },
  selected: { borderColor: colors.orange },
})
