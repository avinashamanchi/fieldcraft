import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { aiConsentStore, type AiConsentStore } from '../../src/ai/consentStore'
import { useAuth } from '../../src/auth/AuthProvider'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { colors, spacing, typography } from '../../src/theme/tokens'

export const AiConsentControls = ({ ownerId, store = aiConsentStore }: { ownerId: string; store?: AiConsentStore }) => {
  const [granted, setGranted] = useState<boolean | null>(null)
  useEffect(() => { let active = true; void store.hasConsent(ownerId).then((value) => { if (active) setGranted(value) }); return () => { active = false } }, [ownerId, store])
  const grant = async () => { await store.grant(ownerId); setGranted(true) }
  const revoke = async () => { await store.revoke(ownerId); setGranted(false) }
  return (
    <>
      <Text accessibilityLiveRegion="polite" style={styles.status}>{granted === null ? 'Checking AI consent…' : granted ? 'AI access is on for this account.' : 'AI access is off for this account.'}</Text>
      <Text style={styles.copy}>When enabled, only a transcript you submit or reviewed vendor, amount, and notes are sent through FieldCraft’s authenticated function to Groq. Raw audio and receipt images stay on the device.</Text>
      {granted ? <PrimaryButton label="Revoke AI consent" onPress={revoke} testID="revoke-ai-consent" /> : <PrimaryButton disabled={granted === null} label="Allow optional AI features" onPress={grant} testID="grant-ai-consent" />}
    </>
  )
}

export default function AiSettingsScreen() {
  const auth = useAuth()
  if (auth.status !== 'signedIn') return <Screen><Text accessibilityRole="alert" style={styles.copy}>Sign in to manage AI consent.</Text></Screen>
  return <Screen contentContainerStyle={styles.screen}><Text accessibilityRole="header" style={styles.heading}>AI & consent</Text><AiConsentControls ownerId={auth.userId} /></Screen>
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  screen: { gap: spacing.lg },
  status: { color: colors.orange, fontFamily: typography.body, fontSize: 17, fontWeight: '800' },
})
