import { useRef, useState } from 'react'
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

export type OnboardingProfile = {
  name: string
  businessName: string
  trade: string
  rate: number
  tax: number
  paymentTerms: string
}

type OnboardingScreenProps = {
  onComplete?: (profile: OnboardingProfile) => Promise<void>
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

export default function OnboardingScreen({
  onComplete = async () => router.replace('/'),
}: OnboardingScreenProps) {
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
    const profile: OnboardingProfile = {
      name: name.trim(),
      businessName: businessName.trim(),
      trade: trade.trim(),
      rate: Number(rate),
      tax: Number(tax),
      paymentTerms: paymentTerms.trim(),
    }
    if (
      profile.name.length < 1 || profile.name.length > 100 ||
      profile.businessName.length < 1 || profile.businessName.length > 120 ||
      profile.trade.length < 1 || profile.trade.length > 80 ||
      profile.paymentTerms.length < 1 || profile.paymentTerms.length > 40 ||
      !Number.isFinite(profile.rate) || profile.rate <= 0 || profile.rate > 1_000_000 ||
      !Number.isFinite(profile.tax) || profile.tax < 0 || profile.tax > 100
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
