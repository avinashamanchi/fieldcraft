import { useEffect } from 'react'
import { router } from 'expo-router'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { useSubscription } from '../../src/billing/SubscriptionProvider'
import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../src/theme/tokens'

const PRIVACY_URL = 'https://avinashamanchi.github.io/fieldcraft/privacy.html'
const TERMS_URL = 'https://avinashamanchi.github.io/fieldcraft/terms.html'
const SUPPORT_URL = 'https://avinashamanchi.github.io/fieldcraft/support.html'
const APPLE_PURCHASE_SUPPORT_URL = 'https://reportaproblem.apple.com/'

export default function SubscriptionScreen() {
  const subscription = useSubscription()

  useEffect(() => {
    void subscription.loadPackages()
  // The provider exposes stable commands for the lifetime of this route.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const developmentBuildRequired = subscription.entitlement.state === 'unknown' &&
    subscription.entitlement.reason === 'development-build-required'

  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.heading}>FieldCraft Pro</Text>
      <Text style={styles.subtitle}>More room for an active business, with every existing record preserved if you downgrade.</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Free</Text>
        <Text style={styles.copy}>10 clients · 3 open jobs · 5 newly issued estimates or invoices per rolling 30 days</Text>
        <Text style={styles.copy}>Editing, payments, sync, exports, and deletion stay available after downgrade.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pro</Text>
        <Text style={styles.copy}>Unlocks above-free client, open-job, estimate, and invoice creation after FieldCraft verifies the purchase with the server.</Text>
        {developmentBuildRequired
          ? <Text accessibilityRole="alert" style={styles.notice}>Purchases require the FieldCraft development build. Expo Go cannot buy or grant Pro.</Text>
          : subscription.packages.map((item) => (
            <Pressable
              accessibilityRole="button"
              disabled={subscription.busy}
              key={item.id}
              onPress={() => void subscription.purchase(item.id)}
              style={({ pressed }) => [styles.purchase, pressed && styles.pressed]}
            >
              <Text style={styles.purchaseTitle}>{item.period === 'monthly' ? 'Monthly' : 'Annual'} · {item.price}</Text>
              <Text style={styles.purchaseDetail}>Auto-renewing {item.period} subscription</Text>
            </Pressable>
          ))}
        {!developmentBuildRequired && subscription.packages.length === 0 && subscription.busy
          ? <ActivityIndicator accessibilityLabel="Loading FieldCraft plans" color={colors.orange} />
          : null}
      </View>

      <Text style={styles.renewal}>Payment is charged to your Apple ID. The subscription renews automatically unless cancelled at least 24 hours before the current period ends. Apple manages billing, renewal, cancellation, and refunds.</Text>
      {subscription.message ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{subscription.message}</Text> : null}
      <Pressable accessibilityRole="button" disabled={subscription.busy} onPress={() => void subscription.restore()} style={styles.secondary}>
        <Text style={styles.secondaryText}>Restore purchases</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={subscription.busy} onPress={() => void subscription.manage()} style={styles.secondary}>
        <Text style={styles.secondaryText}>Manage subscription with Apple</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(PRIVACY_URL) }} style={styles.secondary}>
        <Text style={styles.secondaryText}>Privacy Policy</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(TERMS_URL) }} style={styles.secondary}>
        <Text style={styles.secondaryText}>Terms of Use</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(SUPPORT_URL) }} style={styles.secondary}>
        <Text style={styles.secondaryText}>FieldCraft Support</Text>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(APPLE_PURCHASE_SUPPORT_URL) }} style={styles.secondary}>
        <Text style={styles.secondaryText}>Apple purchase and refund help</Text>
      </Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  back: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  backText: { color: colors.orange, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: '#272727', borderColor: '#444', borderRadius: 16, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  cardTitle: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 24, fontWeight: '800' },
  copy: { color: '#D7D2CA', fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  notice: { color: colors.orange, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  pressed: { opacity: 0.78 },
  purchase: { backgroundColor: colors.orange, borderRadius: 12, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, padding: spacing.md },
  purchaseDetail: { color: colors.charcoal, fontFamily: typography.body, fontSize: 13 },
  purchaseTitle: { color: colors.charcoal, fontFamily: typography.body, fontSize: 17, fontWeight: '800' },
  renewal: { color: '#B8B2A8', fontFamily: typography.body, fontSize: 13, lineHeight: 19 },
  screen: { gap: spacing.md, paddingBottom: spacing.xl },
  secondary: { borderColor: '#666', borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  secondaryText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  subtitle: { color: '#D7D2CA', fontFamily: typography.body, fontSize: 17, lineHeight: 24 },
})
