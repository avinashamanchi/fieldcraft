import { StyleSheet, Text, View } from 'react-native'

import { colors, spacing, typography } from '../theme/tokens'
import { PrimaryButton } from './PrimaryButton'

type ErrorStateProps = { message: string; onRetry?: () => void }

export const ErrorState = ({ message, onRetry }: ErrorStateProps) => (
  <View accessibilityRole="alert" style={styles.container}>
    <Text style={styles.title}>Couldn’t load this workspace</Text>
    <Text style={styles.message}>{message}</Text>
    {onRetry ? <PrimaryButton label="Try again" onPress={onRetry} /> : null}
  </View>
)

const styles = StyleSheet.create({
  container: { borderLeftColor: colors.danger, borderLeftWidth: 4, gap: spacing.md, padding: spacing.lg },
  message: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  title: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 18, fontWeight: '800' },
})
