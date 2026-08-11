import { StyleSheet, Text, View } from 'react-native'

import { colors, radius, spacing, typography } from '../theme/tokens'

type StatCardProps = { label: string; value: string; warning?: boolean }

export const StatCard = ({ label, value, warning = false }: StatCardProps) => (
  <View accessibilityLabel={`${label}: ${value}`} style={styles.card}>
    <Text style={styles.label}>{label}</Text>
    <Text adjustsFontSizeToFit={false} style={[styles.value, warning && styles.warning]}>{value}</Text>
  </View>
)

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.sm,
    minWidth: 132,
    padding: spacing.lg,
  },
  label: { color: colors.muted, fontFamily: typography.utility, fontSize: 12, letterSpacing: 0.4 },
  value: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 25, fontWeight: '800' },
  warning: { color: colors.warning },
})
