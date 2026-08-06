import { router } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../src/theme/tokens'

export default function SettingsScreen() {
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Settings</Text>
      <Text style={styles.section}>Catalog</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/services')} style={styles.row}><Text style={styles.label}>Services</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/inventory')} style={styles.row}><Text style={styles.label}>Inventory</Text></Pressable>
      <Text style={styles.note}>Account and privacy controls are completed in the privacy task.</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
  note: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  row: { borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  screen: { gap: spacing.md },
  section: { color: colors.orange, fontFamily: typography.utility, fontSize: 13, marginTop: spacing.xl },
})
