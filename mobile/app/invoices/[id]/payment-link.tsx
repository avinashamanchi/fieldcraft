import { useLocalSearchParams } from 'expo-router'
import { useRef, useState } from 'react'
import { Share, StyleSheet, Text } from 'react-native'

import { PrimaryButton } from '../../../src/components/PrimaryButton'
import { Screen } from '../../../src/components/Screen'
import { getPaymentService } from '../../../src/payments/paymentService'
import { colors, spacing, typography } from '../../../src/theme/tokens'

export default function InvoicePaymentLinkScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const service = useRef(getPaymentService()).current
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const create = async () => {
    setBusy(true); setMessage(null)
    try { setLink(await service.createPaymentLink(id)); setMessage('A new expiring link is ready. Any prior link for this invoice was revoked.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The payment link could not be created.') }
    finally { setBusy(false) }
  }
  const revoke = async () => {
    setBusy(true); setMessage(null)
    try { await service.revokePaymentLink(id); setLink(null); setMessage('Payment link revoked.') }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'The payment link could not be revoked.') }
    finally { setBusy(false) }
  }
  return <Screen contentContainerStyle={styles.screen} scroll>
    <Text accessibilityRole="header" style={styles.heading}>Customer payment link</Text>
    <Text style={styles.copy}>The hosted page shows only your business name, invoice number, and USD balance. Payment remains pending until FieldCraft receives Stripe’s signed webhook.</Text>
    <PrimaryButton disabled={busy} label={busy ? 'Working…' : link ? 'Replace link' : 'Create link'} onPress={() => { void create() }} />
    {link ? <>
      <Text selectable style={styles.link}>{link.url}</Text>
      <Text style={styles.copy}>Expires {new Date(link.expiresAt).toLocaleString()}</Text>
      <PrimaryButton label="Share link" onPress={() => { void Share.share({ message: link.url, title: 'Invoice payment link' }) }} />
      <PrimaryButton disabled={busy} label="Revoke link" onPress={() => { void revoke() }} />
    </> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </Screen>
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  link: { color: colors.orange, fontFamily: typography.utility, fontSize: 13 },
  message: { color: colors.warning, fontFamily: typography.body, fontSize: 14 },
  screen: { gap: spacing.lg },
})
