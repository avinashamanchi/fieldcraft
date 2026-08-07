import { router } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useAuthActions } from '../../src/auth/AuthProvider'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../src/theme/tokens'

export default function SettingsScreen() {
  const { signOut } = useAuthActions()
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Settings</Text>
      <Text style={styles.section}>Catalog</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/services')} style={styles.row}><Text style={styles.label}>Services</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/inventory')} style={styles.row}><Text style={styles.label}>Inventory</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/business-logo' as never)} style={styles.row}><Text style={styles.label}>Business logo</Text></Pressable>
      <Text style={styles.section}>Privacy & account</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/ai' as never)} style={styles.row}><Text style={styles.label}>AI & consent</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/sync' as never)} style={styles.row}><Text style={styles.label}>Sync diagnostics</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/security/mfa' as never)} style={styles.row}><Text style={styles.label}>Authenticator security</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/privacy' as never)} style={styles.row}><Text style={styles.label}>Privacy policy & support</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/delete-data' as never)} style={styles.row}><Text style={styles.danger}>Delete local data</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/delete-account' as never)} style={styles.row}><Text style={styles.danger}>Delete account</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void signOut('local')} style={styles.row}><Text style={styles.label}>Sign out on this device</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => void signOut('global')} style={styles.row}><Text style={styles.danger}>Sign out on all devices</Text></Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  danger: { color: colors.danger, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
  row: { borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  screen: { gap: spacing.md },
  section: { color: colors.orange, fontFamily: typography.utility, fontSize: 13, marginTop: spacing.xl },
})
