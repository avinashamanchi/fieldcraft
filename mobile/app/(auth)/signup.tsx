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

import { getAuthService, type AuthService } from '../../src/auth/authService'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type SignupScreenProps = {
  service?: AuthService
  onVerificationRequired?: (email: string) => void
}

export default function SignupScreen({
  service = getAuthService(),
  onVerificationRequired = () => router.replace('/(auth)/verify-email'),
}: SignupScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submissionLocked = useRef(false)

  const submit = async () => {
    if (submissionLocked.current) return
    submissionLocked.current = true
    setSubmitting(true)
    setError('')
    const normalizedEmail = email.trim().toLowerCase()
    if (
      normalizedEmail.length < 3 ||
      normalizedEmail.length > 254 ||
      !EMAIL_PATTERN.test(normalizedEmail)
    ) {
      setError('Enter a valid email address.')
      submissionLocked.current = false
      setSubmitting(false)
      return
    }
    if (password.length < 8 || password.length > 128) {
      setError('Password must be between 8 and 128 characters.')
      setPassword('')
      submissionLocked.current = false
      setSubmitting(false)
      return
    }
    try {
      const result = await service.signUp(normalizedEmail, password)
      setPassword('')
      if (result.verificationRequired) onVerificationRequired(normalizedEmail)
    } catch {
      setPassword('')
      setError('Unable to create your account. Please try again.')
    } finally {
      submissionLocked.current = false
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>Your email must be verified before local records unlock.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            maxLength={254}
            onChangeText={setEmail}
            style={styles.input}
            value={email}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="new-password"
            maxLength={128}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
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
          <Text style={styles.primaryButtonText}>{submitting ? 'Please wait…' : 'Create account'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.link}>Back to sign in</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F4ED', flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { color: '#17251C', fontSize: 32, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#4D5B52', fontSize: 16, lineHeight: 24, marginBottom: 28 },
  field: { marginBottom: 18 },
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
  link: { color: '#1F603C', fontSize: 16, fontWeight: '700', paddingVertical: 16, textAlign: 'center' },
})
