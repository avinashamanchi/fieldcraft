import * as WebBrowser from 'expo-web-browser'
import { router } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, Text } from 'react-native'

import { useSubscription } from '../../src/billing/SubscriptionProvider'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { getPaymentService, type ConnectStatus } from '../../src/payments/paymentService'
import { colors, spacing, typography } from '../../src/theme/tokens'

export default function PaymentSettingsScreen() {
  const { entitlement } = useSubscription()
  const [status, setStatus] = useState<ConnectStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const service = useRef(getPaymentService()).current
  const refresh = useCallback(async () => {
    setBusy(true); setMessage(null)
    try { setStatus(await service.refreshConnectStatus()) }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Payment status is unavailable.') }
    finally { setBusy(false) }
  }, [service])
  useEffect(() => { if (entitlement.state === 'pro') void refresh() }, [entitlement.state, refresh])
  const connect = async () => {
    setBusy(true); setMessage(null)
    try {
      const link = await service.createConnectOnboarding()
      await WebBrowser.openBrowserAsync(link.url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET })
      await refresh()
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Connect onboarding could not be opened.'); setBusy(false) }
  }
  const disconnect = () => Alert.alert('Disconnect customer payments?', 'New payment links will stop working. Existing provider records remain subject to provider retention rules.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Disconnect', style: 'destructive', onPress: () => { void (async () => { setBusy(true); try { await service.disconnectConnect(); setStatus({ state: 'not-connected', chargesEnabled: false, payoutsEnabled: false }); setMessage('Customer payments disconnected.') } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Payments could not be disconnected.') } finally { setBusy(false) } })() } },
  ])
  if (entitlement.state !== 'pro') return <Screen contentContainerStyle={styles.screen}><Text accessibilityRole="header" style={styles.heading}>Customer payments</Text><Text style={styles.copy}>Customer payment links require a verified FieldCraft Pro subscription. Your App Store subscription is separate from customer invoice payments.</Text><PrimaryButton label="View FieldCraft Pro" onPress={() => router.push('/subscription' as never)} /></Screen>
  return <Screen contentContainerStyle={styles.screen} scroll>
    <Text accessibilityRole="header" style={styles.heading}>Customer payments</Text>
    <Text style={styles.copy}>Connect a Stripe account to accept real-world invoice payments. FieldCraft never stores card or bank details. Apple Pay appears only when Stripe, the device, and the customer are eligible.</Text>
    <Text accessibilityLiveRegion="polite" style={styles.status}>Status: {status?.state ?? 'Not checked'}</Text>
    {status?.state === 'complete'
      ? <PrimaryButton disabled={busy} label={busy ? 'Working…' : 'Disconnect Stripe'} onPress={disconnect} />
      : <PrimaryButton disabled={busy} label={busy ? 'Working…' : 'Connect with Stripe'} onPress={() => { void connect() }} />}
    <PrimaryButton disabled={busy} label="Refresh status" onPress={() => { void refresh() }} />
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
  </Screen>
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  message: { color: colors.warning, fontFamily: typography.body, fontSize: 14 },
  screen: { gap: spacing.lg },
  status: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 14 },
})
