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

type ResetPasswordScreenProps = {
  service?: AuthService
  onSuccess?: () => void
}

export default function ResetPasswordScreen({
  service = getAuthService(),
  onSuccess = () => router.replace('/(auth)/login'),
}: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submissionLocked = useRef(false)

  const submit = async () => {
    if (submissionLocked.current) return
    submissionLocked.current = true
    setSubmitting(true)
    setError('')
    if (password.length < 8 || password.length > 128) {
      setError('Password must be between 8 and 128 characters.')
      setPassword('')
      setConfirmation('')
      submissionLocked.current = false
      setSubmitting(false)
      return
    }
    if (confirmation !== password) {
      setError('Passwords do not match.')
      setPassword('')
      setConfirmation('')
      submissionLocked.current = false
      setSubmitting(false)
      return
    }
    try {
      await service.updatePassword(password)
      setPassword('')
      setConfirmation('')
      onSuccess()
    } catch {
      setPassword('')
      setConfirmation('')
      setError('Unable to update your password. Please try again.')
    } finally {
      submissionLocked.current = false
      setSubmitting(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>Use between 8 and 128 characters.</Text>
        <View style={styles.field}>
          <Text style={styles.label}>New password</Text>
          <TextInput
            accessibilityLabel="New password"
            autoCapitalize="none"
            autoComplete="new-password"
            maxLength={128}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            accessibilityLabel="Confirm new password"
            autoCapitalize="none"
            autoComplete="new-password"
            maxLength={128}
            onChangeText={setConfirmation}
            secureTextEntry
            style={styles.input}
            value={confirmation}
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
          <Text style={styles.primaryButtonText}>{submitting ? 'Please wait…' : 'Update password'}</Text>
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
})
