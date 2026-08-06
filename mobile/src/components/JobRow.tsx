import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Job } from '../domain/entities'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../theme/tokens'

type JobRowProps = { job: Job; onPress?: () => void }

export const JobRow = ({ job, onPress }: JobRowProps) => (
  <Pressable
    accessibilityLabel={`${job.title}, ${job.status}`}
    accessibilityRole={onPress ? 'button' : 'text'}
    disabled={!onPress}
    onPress={onPress}
    style={styles.row}
  >
    <View style={styles.copy}>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.meta}>{job.status}</Text>
    </View>
    <View accessibilityLabel={`Sync status ${job.syncState}`} style={styles.syncDot} />
  </Pressable>
)

const styles = StyleSheet.create({
  copy: { flex: 1, gap: spacing.xs },
  meta: { color: colors.muted, fontFamily: typography.utility, fontSize: 12 },
  row: {
    alignItems: 'center',
    borderBottomColor: '#353535',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.md,
  },
  syncDot: { backgroundColor: colors.success, borderRadius: 4, height: 8, width: 8 },
  title: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
})
