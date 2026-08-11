import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Image } from 'expo-image'

import { useAuthActions, useAuthenticatedOwnerLease } from '../../src/auth/AuthProvider'
import { createMfaService, type MfaService } from '../../src/auth/mfaService'
import { getRecentAal2Guard } from '../../src/auth/requireAal2'
import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing } from '../../src/theme/tokens'

export default function MfaScreen({ service: suppliedService }: { service?: MfaService }) {
  const lease = useAuthenticatedOwnerLease()
  const { verifyMfaChallenge } = useAuthActions()
  const service = useMemo(() => suppliedService ?? createMfaService(), [suppliedService])
  const [factors, setFactors] = useState<{ id: string; friendlyName?: string }[]>([])
  const [enrollment, setEnrollment] = useState<Awaited<ReturnType<MfaService['enrollTotp']>> | null>(null)
  const enrollmentRef = useRef<Awaited<ReturnType<MfaService['enrollTotp']>> | null>(null)
  const enrollmentLocked = useRef(false)
  const mounted = useRef(true)
  const [enrolling, setEnrolling] = useState(false)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => setFactors(await service.listVerifiedTotp()), [service])
  useEffect(() => { void refresh().catch(() => setMessage('Authenticator settings are unavailable.')) }, [refresh])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const abandoned = enrollmentRef.current
      enrollmentRef.current = null
      if (abandoned) void service.cleanupUnverifiedTotp(abandoned.factorId).catch(() => {})
    }
  }, [service])

  const startEnrollment = async () => {
    if (enrollmentLocked.current) return
    enrollmentLocked.current = true
    setEnrolling(true)
    setMessage('')
    try {
      await service.cleanupUnverifiedTotp()
      const next = await service.enrollTotp()
      if (!mounted.current) {
        await service.cleanupUnverifiedTotp(next.factorId)
        return
      }
      enrollmentRef.current = next
      setEnrollment(next)
    } catch {
      if (mounted.current) setMessage('Authenticator enrollment is unavailable.')
    } finally {
      enrollmentLocked.current = false
      if (mounted.current) setEnrolling(false)
    }
  }

  const cancelEnrollment = async () => {
    const abandoned = enrollmentRef.current
    if (!abandoned) return
    try {
      await service.cleanupUnverifiedTotp(abandoned.factorId)
      enrollmentRef.current = null
      setEnrollment(null)
      setCode('')
      setMessage('Authenticator enrollment cancelled.')
    } catch {
      setMessage('Authenticator enrollment could not be cancelled securely.')
    }
  }

  const verifyEnrollment = async () => {
    if (!enrollment || !lease) return
    try {
      await verifyMfaChallenge(() => service.verifyEnrollment(enrollment.factorId, code))
      enrollmentRef.current = null
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
          disabled={enrolling}
          onPress={() => void startEnrollment()}
          style={[styles.button, enrolling && styles.disabled]}
        >
          <Text style={styles.buttonText}>{enrolling ? 'Adding authenticator…' : 'Add authenticator'}</Text>
        </Pressable>
      ) : (
        <View style={styles.factor}>
          <Image
            accessibilityLabel="Authenticator QR code"
            contentFit="contain"
            source={{ uri: enrollment.qrCodeDataUri }}
            style={styles.qrCode}
          />
          <Text style={styles.body}>Cannot scan? Enter this setup key:</Text>
          <Text selectable style={styles.setupLink}>{enrollment.secret}</Text>
          <Text style={styles.body}>Or use this full authenticator URI:</Text>
          <Text selectable style={styles.setupLink}>{enrollment.uri}</Text>
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
          <Pressable accessibilityRole="button" onPress={() => void cancelEnrollment()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Cancel enrollment</Text>
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
  qrCode: { alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, height: 240, width: 240 },
  input: { backgroundColor: colors.warmWhite, borderRadius: 10, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14 },
  button: { alignItems: 'center', backgroundColor: colors.orange, borderRadius: 10, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 16 },
  buttonText: { color: colors.charcoal, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  secondaryButton: { alignItems: 'center', borderColor: colors.orange, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 16 },
  secondaryButtonText: { color: colors.orange, fontSize: 16, fontWeight: '800' },
  message: { color: colors.orange, fontSize: 15 },
})
