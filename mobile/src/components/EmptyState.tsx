import { StyleSheet, Text, View } from 'react-native'

import { colors, spacing, typography } from '../theme/tokens'
import { PrimaryButton } from './PrimaryButton'

type EmptyStateProps = {
  actionLabel?: string
  message: string
  onAction?: () => void
  title: string
}

export const EmptyState = ({ actionLabel, message, onAction, title }: EmptyStateProps) => (
  <View accessibilityLabel={`${title}. ${message}`} style={styles.container}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.message}>{message}</Text>
    {actionLabel && onAction ? <PrimaryButton label={actionLabel} onPress={onAction} /> : null}
  </View>
)

const styles = StyleSheet.create({
  container: { alignItems: 'stretch', gap: spacing.md, paddingVertical: spacing.xxl },
  message: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  title: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 28, fontWeight: '800' },
})
