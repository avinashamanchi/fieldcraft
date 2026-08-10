import { Linking, Pressable, StyleSheet, Text } from 'react-native'

import { Screen } from '../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../src/theme/tokens'

const PRIVACY_URL = 'https://avinashamanchi.github.io/fieldcraft/privacy.html'
const TERMS_URL = 'https://avinashamanchi.github.io/fieldcraft/terms.html'
const SUPPORT_URL = 'https://avinashamanchi.github.io/fieldcraft/support.html'

export default function PrivacyScreen() {
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Privacy</Text>
      <Text style={styles.copy}>FieldCraft stores an offline working copy on this device and syncs your business records to your Supabase account. Optional AI processing requires consent. Raw audio and receipt images are not uploaded.</Text>
      <Text style={styles.copy}>FieldCraft does not use ads or tracking, access your contacts or payment-card details, or send customer messages automatically. Apple and RevenueCat process subscription purchase and entitlement information. Review invoices and accounting information yourself.</Text>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(PRIVACY_URL) }} style={styles.link}><Text style={styles.linkText}>Open full privacy policy</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(TERMS_URL) }} style={styles.link}><Text style={styles.linkText}>Open Terms of Use</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(SUPPORT_URL) }} style={styles.link}><Text style={styles.linkText}>Open support page</Text></Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 23 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  link: { justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  linkText: { color: colors.orange, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  screen: { gap: spacing.lg },
})
