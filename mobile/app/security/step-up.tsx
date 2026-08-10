import { useCallback, useEffect, useMemo, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useAuthActions, useAuthenticatedOwnerLease } from '../../src/auth/AuthProvider'
import { createMfaService, type MfaService } from '../../src/auth/mfaService'
import type { SensitiveOperation } from '../../src/auth/requireAal2'
import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing } from '../../src/theme/tokens'

const SENSITIVE_OPERATIONS: readonly SensitiveOperation[] = [
  'stripe-connect', 'payment-link', 'payment-adjustment', 'account-export', 'disable-mfa', 'delete-account',
]

export default function StepUpScreen({ service: suppliedService }: { service?: MfaService }) {
  const lease = useAuthenticatedOwnerLease()
  const { verifyMfaChallenge } = useAuthActions()
  const params = useLocalSearchParams<{ operation?: string }>()
  const operation = SENSITIVE_OPERATIONS.includes(params.operation as SensitiveOperation)
    ? params.operation as SensitiveOperation
    : 'account-export'
  const service = useMemo(() => suppliedService ?? createMfaService(), [suppliedService])
  const [factorId, setFactorId] = useState('')
  const [factorStatus, setFactorStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')

  const loadFactors = useCallback(async () => {
    setFactorStatus('loading')
    setMessage('')
    try {
      const factors = await service.listVerifiedTotp()
      const first = factors[0]?.id ?? ''
      setFactorId(first)
      setFactorStatus(first ? 'ready' : 'missing')
    } catch {
      setFactorId('')
      setFactorStatus('error')
      setMessage('Authenticator verification is unavailable.')
    }
  }, [service])

  useEffect(() => { void loadFactors() }, [loadFactors])

  const verify = async () => {
    if (!lease || !factorId) {
      setMessage('Enable an authenticator before continuing.')
      return
    }
    try {
      await verifyMfaChallenge(() => service.stepUp(factorId, code))
      setCode('')
      router.back()
    } catch {
      setCode('')
      setMessage(`Verification is required for ${operation}.`)
    }
  }

  return (
    <Screen contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.heading}>Verify it’s you</Text>
      {factorStatus === 'missing' ? (
        <View style={styles.setup}>
          <Text style={styles.body}>No verified authenticator is available. Set one up, then return to {operation === 'delete-account' ? 'Delete account' : 'this action'} and try again.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/security/mfa' as never)} style={styles.button}>
            <Text style={styles.buttonText}>Set up authenticator</Text>
          </Pressable>
        </View>
      ) : factorStatus === 'error' ? (
        <View style={styles.setup}>
          <Text style={styles.body}>FieldCraft could not safely check your authenticator. Check your connection and retry.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void loadFactors() }} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.body}>{factorStatus === 'loading' ? 'Checking authenticator security…' : 'Enter the current six-digit code from your authenticator.'}</Text>
          <TextInput
            accessibilityLabel="Six-digit authenticator code"
            editable={factorStatus === 'ready'}
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            secureTextEntry
            style={styles.input}
            value={code}
          />
          <Pressable accessibilityRole="button" disabled={factorStatus !== 'ready'} onPress={() => void verify()} style={[styles.button, factorStatus !== 'ready' && styles.disabled]}>
            <Text style={styles.buttonText}>Verify and continue</Text>
          </Pressable>
        </>
      )}
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg, justifyContent: 'center' },
  heading: { color: colors.warmWhite, fontSize: 30, fontWeight: '800' },
  body: { color: colors.warmWhite, fontSize: 16, lineHeight: 23 },
  input: { backgroundColor: colors.warmWhite, borderRadius: 10, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: colors.orange, borderRadius: 10, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  buttonText: { color: colors.charcoal, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  message: { color: colors.danger, fontSize: 15 },
  setup: { gap: spacing.lg },
})
