import { StyleSheet, Text, View } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { useSyncStatus } from '../../src/data/SyncProvider'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

export default function SyncSettingsScreen() {
  const { owner } = useFieldCraftData()
  const status = useSyncStatus()
  return (
    <Screen contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.heading}>Sync diagnostics</Text>
      <Text style={styles.copy}>Diagnostics show status and counts only. They never display job, client, invoice, expense, transcript, or receipt content.</Text>
      <View style={styles.card}><Text style={styles.label}>State</Text><Text style={styles.value}>{status.state}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Conflicts</Text><Text style={styles.value}>{status.state === 'conflict' ? status.count : 0}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Local revision</Text><Text style={styles.value}>{owner.dataRevision}</Text></View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.sm, padding: spacing.lg },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  label: { color: colors.muted, fontFamily: typography.body, fontSize: 13 },
  screen: { gap: spacing.lg },
  value: { color: colors.orange, fontFamily: typography.utility, fontSize: 18 },
})
