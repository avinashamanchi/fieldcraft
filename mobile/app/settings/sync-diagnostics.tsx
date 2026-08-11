import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { useCallback, useEffect, useState } from 'react'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { useSyncStatus } from '../../src/data/SyncProvider'
import type { QuarantinedMutation } from '../../src/data/quarantine'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

export default function SyncDiagnosticsScreen() {
  const { owner, repository } = useFieldCraftData()
  const status = useSyncStatus()
  const [quarantined, setQuarantined] = useState<QuarantinedMutation[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!owner.ownerId) {
      setQuarantined([])
      return
    }
    try {
      setQuarantined(await repository.listQuarantined(owner.ownerId))
      setMessage(null)
    } catch {
      setMessage('Quarantine details could not be loaded securely. Try again.')
    }
  }, [owner.ownerId, repository])

  useEffect(() => { void load() }, [load, owner.dataRevision])

  const retry = async (mutationId: string) => {
    if (!owner.ownerId) return
    try {
      await repository.retryQuarantined(owner.ownerId, mutationId)
      setMessage('The saved change is queued for another attempt.')
      await load()
    } catch {
      setMessage('That change could not be queued. Its quarantined copy is still safe.')
    }
  }

  const exportMutation = async (mutationId: string) => {
    if (!owner.ownerId) return
    try {
      const payload = await repository.exportQuarantined(owner.ownerId, mutationId)
      await Share.share({ message: payload, title: 'FieldCraft unsynced change' })
      setMessage('A recovery copy was prepared. FieldCraft did not delete the original.')
    } catch {
      setMessage('The recovery copy could not be prepared. The original remains quarantined.')
    }
  }

  const confirmDiscard = (mutationId: string) => {
    if (!owner.ownerId) return
    Alert.alert(
      'Discard this unsynced change?',
      'This is the only action here that permanently removes the quarantined copy. Export it first if you may need it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard copy',
          style: 'destructive',
          onPress: () => {
            void repository.discardQuarantined(
              owner.ownerId!,
              mutationId,
              'DISCARD UNSYNCED CHANGE',
            ).then(load).catch(() => {
              setMessage('The copy was not discarded. It remains available.')
            })
          },
        },
      ],
    )
  }

  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Sync diagnostics</Text>
      <Text style={styles.copy}>Status and safe identifiers appear here. Business content is shown only if you explicitly export one recovery copy.</Text>
      <View style={styles.card}><Text style={styles.label}>State</Text><Text style={styles.value}>{status.state}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Conflicts</Text><Text style={styles.value}>{status.state === 'conflict' ? status.count : 0}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Quarantined changes</Text><Text style={styles.value}>{quarantined.length}</Text></View>
      <View style={styles.card}><Text style={styles.label}>Local revision</Text><Text style={styles.value}>{owner.dataRevision}</Text></View>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
      <Text accessibilityRole="header" style={styles.subheading}>Recovery</Text>
      {quarantined.length === 0 ? <Text style={styles.copy}>No changes need recovery.</Text> : quarantined.map((item) => (
        <View key={item.mutationId} style={styles.recoveryCard}>
          <Text style={styles.recoveryTitle}>{item.entity.replace('_', ' ')}</Text>
          <Text style={styles.copy}>Reason: {item.reason} · attempts: {item.attempts}</Text>
          <Text style={styles.identifier} numberOfLines={1}>ID {item.mutationId}</Text>
          <View style={styles.actions}>
            {!item.supersededBy ? <Action label="Retry" onPress={() => { void retry(item.mutationId) }} /> : null}
            <Action label="Export copy" onPress={() => { void exportMutation(item.mutationId) }} />
            <Action danger label="Discard copy" onPress={() => confirmDiscard(item.mutationId)} />
          </View>
        </View>
      ))}
    </Screen>
  )
}

const Action = ({ danger = false, label, onPress }: {
  danger?: boolean
  label: string
  onPress(): void
}) => (
  <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
    <Text style={danger ? styles.danger : styles.actionLabel}>{label}</Text>
  </Pressable>
)

const styles = StyleSheet.create({
  action: { justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  actionLabel: { color: colors.orange, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.sm, padding: spacing.lg },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  danger: { color: colors.danger, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  identifier: { color: colors.muted, fontFamily: typography.utility, fontSize: 12 },
  label: { color: colors.muted, fontFamily: typography.body, fontSize: 13 },
  message: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  recoveryCard: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.sm, padding: spacing.lg },
  recoveryTitle: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 18, fontWeight: '700', textTransform: 'capitalize' },
  screen: { gap: spacing.lg },
  subheading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 24, fontWeight: '800' },
  value: { color: colors.orange, fontFamily: typography.utility, fontSize: 18 },
})
