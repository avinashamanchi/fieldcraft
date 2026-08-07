import * as Crypto from 'expo-crypto'
import { useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuthenticatedOwnerLease } from '../../src/auth/AuthProvider'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { OnboardingProfileV1, PaymentTerms, TradeType } from '../../src/domain/entities'
import { createOnboardingSaver } from '../../src/features/onboarding/saveOnboarding'

type OnboardingScreenProps = {
  onComplete?: (profile: OnboardingProfileV1) => Promise<void>
  now?: () => string
  timeZone?: string
}

type TextFieldProps = {
  label: string
  accessibilityLabel: string
  value: string
  onChangeText(value: string): void
  maxLength: number
  keyboardType?: 'default' | 'decimal-pad'
}

const TextField = ({
  label,
  accessibilityLabel,
  value,
  onChangeText,
  maxLength,
  keyboardType = 'default',
}: TextFieldProps) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={accessibilityLabel}
      keyboardType={keyboardType}
      maxLength={maxLength}
      onChangeText={onChangeText}
      style={styles.input}
      value={value}
    />
  </View>
)

const TRADES: readonly TradeType[] = [
  'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting',
]
const PAYMENT_TERMS: readonly PaymentTerms[] = ['Due on receipt', 'Net 14', 'Net 30']

const scaledDecimal = (value: string, decimalPlaces: number): number | null => {
  const match = value.trim().match(/^(\d{1,9})(?:\.(\d{1,2}))?$/)
  if (!match) return null
  const fractional = (match[2] ?? '').padEnd(decimalPlaces, '0')
  const scaled = Number(match[1]) * 10 ** decimalPlaces + Number(fractional)
  return Number.isSafeInteger(scaled) ? scaled : null
}

const OnboardingForm = ({
  onComplete,
  now = () => new Date().toISOString(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
}: Required<Pick<OnboardingScreenProps, 'onComplete'>> & Omit<OnboardingScreenProps, 'onComplete'>) => {
  const [name, setName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [trade, setTrade] = useState('')
  const [rate, setRate] = useState('')
  const [tax, setTax] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submissionLocked = useRef(false)

  const submit = async () => {
    if (submissionLocked.current) return
    submissionLocked.current = true
    setSubmitting(true)
    setError('')
    const tradeType = trade.trim()
    const selectedPaymentTerms = paymentTerms.trim()
    const hourlyRateCents = scaledDecimal(rate, 2)
    const taxBasisPoints = scaledDecimal(tax, 2)
    const profile: OnboardingProfileV1 = {
      displayName: name.trim(),
      businessName: businessName.trim(),
      tradeType: tradeType as TradeType,
      hourlyRateCents: hourlyRateCents ?? -1,
      taxBasisPoints: taxBasisPoints ?? -1,
      paymentTerms: selectedPaymentTerms as PaymentTerms,
      countryCode: 'US',
      currency: 'USD',
      timeZone,
      onboardingVersion: 1,
      onboardingCompletedAt: now(),
    }
    if (
      profile.displayName.length < 1 || profile.displayName.length > 100 ||
      profile.businessName.length < 1 || profile.businessName.length > 120 ||
      !TRADES.includes(profile.tradeType) ||
      !PAYMENT_TERMS.includes(profile.paymentTerms) ||
      !Number.isSafeInteger(profile.hourlyRateCents) ||
      profile.hourlyRateCents <= 0 || profile.hourlyRateCents > 100_000_000 ||
      !Number.isSafeInteger(profile.taxBasisPoints) ||
      profile.taxBasisPoints < 0 || profile.taxBasisPoints > 10_000 ||
      timeZone.length < 1 || timeZone.length > 100
    ) {
      setError('Check each field and enter values within the shown limits.')
      submissionLocked.current = false
      setSubmitting(false)
      return
    }
    try {
      await onComplete(profile)
    } catch {
      setError('Unable to save your profile. Please try again.')
    } finally {
      submissionLocked.current = false
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>Set up FieldCraft</Text>
        <Text style={styles.subtitle}>Add only the basics needed for jobs and invoices.</Text>
        <TextField accessibilityLabel="Your name" label="Your name" maxLength={100} onChangeText={setName} value={name} />
        <TextField accessibilityLabel="Business name" label="Business name" maxLength={120} onChangeText={setBusinessName} value={businessName} />
        <TextField accessibilityLabel="Trade" label="Trade" maxLength={80} onChangeText={setTrade} value={trade} />
        <TextField accessibilityLabel="Hourly rate" keyboardType="decimal-pad" label="Hourly rate" maxLength={12} onChangeText={setRate} value={rate} />
        <TextField accessibilityLabel="Tax percent" keyboardType="decimal-pad" label="Tax percent" maxLength={6} onChangeText={setTax} value={tax} />
        <TextField accessibilityLabel="Payment terms" label="Payment terms" maxLength={40} onChangeText={setPaymentTerms} value={paymentTerms} />
        {error ? (
          <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void submit()}
          style={[styles.primaryButton, submitting && styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>{submitting ? 'Saving…' : 'Finish setup'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const ConnectedOnboardingScreen = () => {
  const lease = useAuthenticatedOwnerLease()
  const { repository } = useFieldCraftData()
  const saver = useMemo(() => lease ? createOnboardingSaver({
    lease,
    repository,
    createMutationId: Crypto.randomUUID,
  }) : null, [lease, repository])

  if (!saver) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <Text accessibilityRole="alert" style={styles.error}>Sign in securely before setup.</Text>
        </View>
      </SafeAreaView>
    )
  }
  return <OnboardingForm onComplete={async (profile) => {
    await saver.save(profile)
    router.replace('/')
  }} />
}

export default function OnboardingScreen(props: OnboardingScreenProps) {
  if (props.onComplete) return <OnboardingForm {...props} onComplete={props.onComplete} />
  return <ConnectedOnboardingScreen />
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F4ED', flex: 1 },
  container: { padding: 24, paddingBottom: 48 },
  title: { color: '#17251C', fontSize: 32, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#4D5B52', fontSize: 16, lineHeight: 24, marginBottom: 28 },
  field: { marginBottom: 16 },
  label: { color: '#17251C', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#FFFFFF', borderColor: '#9BA99F', borderRadius: 12, borderWidth: 1,
    color: '#17251C', fontSize: 17, minHeight: 52, paddingHorizontal: 14,
  },
  error: { color: '#8D251E', fontSize: 15, lineHeight: 22, marginBottom: 14 },
  primaryButton: {
    alignItems: 'center', backgroundColor: '#1F603C', borderRadius: 12, justifyContent: 'center',
    minHeight: 52, paddingHorizontal: 18,
  },
  disabled: { opacity: 0.55 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
})
