import { useCallback, useEffect, useMemo, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { useAuthenticatedOwnerLease } from '../../src/auth/AuthProvider'
import { createMfaService, type MfaService } from '../../src/auth/mfaService'
import { getRecentAal2Guard } from '../../src/auth/requireAal2'
import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing } from '../../src/theme/tokens'

export default function MfaScreen({ service: suppliedService }: { service?: MfaService }) {
  const lease = useAuthenticatedOwnerLease()
  const service = useMemo(() => suppliedService ?? createMfaService(), [suppliedService])
  const [factors, setFactors] = useState<{ id: string; friendlyName?: string }[]>([])
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string } | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => setFactors(await service.listVerifiedTotp()), [service])
  useEffect(() => { void refresh().catch(() => setMessage('Authenticator settings are unavailable.')) }, [refresh])

  const verifyEnrollment = async () => {
    if (!enrollment || !lease) return
    try {
      await service.verifyEnrollment(enrollment.factorId, code)
      getRecentAal2Guard().markVerified({ ...lease, verifiedAt: Date.now() })
      setEnrollment(null)
      setCode('')
      setMessage('Authenticator enabled.')
      await refresh()
    } catch {
      setCode('')
      setMessage('The authenticator code could not be verified.')
    }
  }

  const disable = async (factorId: string) => {
    try {
      getRecentAal2Guard().requireRecentAal2('disable-mfa')
      await service.unenroll(factorId)
      setMessage('Authenticator disabled.')
      await refresh()
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'STEP_UP_REQUIRED') {
        router.push('/security/step-up?operation=disable-mfa' as never)
        return
      }
      setMessage('Authenticator settings are unavailable.')
    }
  }

  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Authenticator security</Text>
      <Text style={styles.body}>Use a six-digit authenticator code for sensitive account actions.</Text>
      {factors.map((factor) => (
        <View key={factor.id} style={styles.factor}>
          <Text style={styles.body}>{factor.friendlyName ?? 'Verified authenticator'}</Text>
          <Pressable accessibilityRole="button" onPress={() => void disable(factor.id)} style={styles.button}>
            <Text style={styles.buttonText}>Disable authenticator</Text>
          </Pressable>
        </View>
      ))}
      {!enrollment ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => void service.enrollTotp().then(setEnrollment).catch(() => setMessage('Authenticator enrollment is unavailable.'))}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Add authenticator</Text>
        </Pressable>
      ) : (
        <View style={styles.factor}>
          <Text selectable style={styles.setupLink}>{enrollment.qrCode}</Text>
          <TextInput
            accessibilityLabel="Six-digit authenticator code"
            keyboardType="number-pad"
            maxLength={6}
            onChangeText={setCode}
            secureTextEntry
            style={styles.input}
            value={code}
          />
          <Pressable accessibilityRole="button" onPress={() => void verifyEnrollment()} style={styles.button}>
            <Text style={styles.buttonText}>Verify authenticator</Text>
          </Pressable>
        </View>
      )}
      {message ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  screen: { gap: spacing.lg },
  heading: { color: colors.warmWhite, fontSize: 30, fontWeight: '800' },
  body: { color: colors.warmWhite, fontSize: 16, lineHeight: 23 },
  factor: { gap: spacing.md },
  setupLink: { color: colors.orange, fontSize: 13, lineHeight: 20 },
  input: { backgroundColor: colors.warmWhite, borderRadius: 10, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: colors.orange, borderRadius: 10, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 16 },
  buttonText: { color: colors.charcoal, fontSize: 16, fontWeight: '800' },
  message: { color: colors.orange, fontSize: 15 },
})
