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

type LoginScreenProps = {
  service?: AuthService
  onSuccess?: () => void
}

export default function LoginScreen({
  service = getAuthService(),
  onSuccess = () => router.replace('/'),
}: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submissionLocked = useRef(false)

  const normalizedEmail = email.trim().toLowerCase()

  const beginSubmission = (): boolean => {
    if (submissionLocked.current) return false
    submissionLocked.current = true
    setSubmitting(true)
    setMessage('')
    return true
  }

  const finishSubmission = () => {
    submissionLocked.current = false
    setSubmitting(false)
  }

  const validateEmail = (): boolean => {
    if (
      normalizedEmail.length < 3 ||
      normalizedEmail.length > 254 ||
      !EMAIL_PATTERN.test(normalizedEmail)
    ) {
      setMessage('Enter a valid email address.')
      return false
    }
    return true
  }

  const submit = async () => {
    if (!beginSubmission()) return
    if (!validateEmail() || password.length < 8 || password.length > 128) {
      if (password.length < 8 || password.length > 128) {
        setMessage('Password must be between 8 and 128 characters.')
      }
      finishSubmission()
      return
    }
    try {
      await service.signIn(normalizedEmail, password)
      setPassword('')
      onSuccess()
    } catch {
      setPassword('')
      setMessage('Unable to sign in. Check your details and try again.')
    } finally {
      finishSubmission()
    }
  }

  const requestReset = async () => {
    if (!beginSubmission()) return
    if (!validateEmail()) {
      finishSubmission()
      return
    }
    try {
      await service.requestPasswordReset(normalizedEmail)
      setPassword('')
      setMessage('Check your email for a password reset link.')
    } catch {
      setPassword('')
      setMessage('Unable to send a reset email. Please try again.')
    } finally {
      finishSubmission()
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Sign in before opening your FieldCraft data.</Text>
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
            autoComplete="current-password"
            maxLength={128}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        {message ? (
          <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.message}>
            {message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void submit()}
          style={[styles.primaryButton, submitting && styles.disabled]}
        >
          <Text style={styles.primaryButtonText}>{submitting ? 'Please wait…' : 'Sign in'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void requestReset()}>
          <Text style={styles.link}>Send reset email</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/signup')}>
          <Text style={styles.link}>Create an account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F4ED', flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: { color: '#17251C', fontSize: 34, fontWeight: '800', marginBottom: 8 },
  subtitle: { color: '#4D5B52', fontSize: 16, lineHeight: 24, marginBottom: 28 },
  field: { marginBottom: 18 },
  label: { color: '#17251C', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#9BA99F',
    borderRadius: 12,
    borderWidth: 1,
    color: '#17251C',
    fontSize: 17,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  message: { color: '#8D251E', fontSize: 15, lineHeight: 22, marginBottom: 14 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#1F603C',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  disabled: { opacity: 0.55 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  link: { color: '#1F603C', fontSize: 16, fontWeight: '700', paddingVertical: 14, textAlign: 'center' },
})
