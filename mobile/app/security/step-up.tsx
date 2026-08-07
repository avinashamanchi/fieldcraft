import { useEffect, useMemo, useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput } from 'react-native'

import { useAuthenticatedOwnerLease } from '../../src/auth/AuthProvider'
import { createMfaService, type MfaService } from '../../src/auth/mfaService'
import { getRecentAal2Guard, type SensitiveOperation } from '../../src/auth/requireAal2'
import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing } from '../../src/theme/tokens'

const SENSITIVE_OPERATIONS: readonly SensitiveOperation[] = [
  'stripe-connect', 'payment-link', 'payment-adjustment', 'account-export', 'disable-mfa', 'delete-account',
]

export default function StepUpScreen({ service: suppliedService }: { service?: MfaService }) {
  const lease = useAuthenticatedOwnerLease()
  const params = useLocalSearchParams<{ operation?: string }>()
  const operation = SENSITIVE_OPERATIONS.includes(params.operation as SensitiveOperation)
    ? params.operation as SensitiveOperation
    : 'account-export'
  const service = useMemo(() => suppliedService ?? createMfaService(), [suppliedService])
  const [factorId, setFactorId] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    void service.listVerifiedTotp().then((factors) => setFactorId(factors[0]?.id ?? '')).catch(() => {
      setMessage('Authenticator verification is unavailable.')
    })
  }, [service])

  const verify = async () => {
    if (!lease || !factorId) {
      setMessage('Enable an authenticator before continuing.')
      return
    }
    try {
      await service.stepUp(factorId, code)
      getRecentAal2Guard().markVerified({ ...lease, verifiedAt: Date.now() })
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
      <Text style={styles.body}>Enter the current six-digit code from your authenticator.</Text>
      <TextInput
        accessibilityLabel="Six-digit authenticator code"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={setCode}
        secureTextEntry
        style={styles.input}
        value={code}
      />
      <Pressable accessibilityRole="button" onPress={() => void verify()} style={styles.button}>
        <Text style={styles.buttonText}>Verify and continue</Text>
      </Pressable>
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
  message: { color: colors.danger, fontSize: 15 },
})
