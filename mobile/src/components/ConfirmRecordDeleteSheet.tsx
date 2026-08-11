import { useEffect, useRef, type RefObject } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../theme/tokens'

type ConfirmRecordDeleteSheetProps = {
  busy?: boolean
  linkedCount: number
  onCancel: () => void
  onConfirm: () => void
  recordLabel: string
  returnFocusRef?: RefObject<{ focus?: () => void } | null>
  visible: boolean
}

export const ConfirmRecordDeleteSheet = ({
  busy = false,
  linkedCount,
  onCancel,
  onConfirm,
  recordLabel,
  returnFocusRef,
  visible,
}: ConfirmRecordDeleteSheetProps) => {
  const wasVisible = useRef(visible)
  useEffect(() => {
    if (wasVisible.current && !visible) returnFocusRef?.current?.focus?.()
    wasVisible.current = visible
  }, [returnFocusRef, visible])
  return (
  <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={styles.sheet}>
        <Text accessibilityRole="header" style={styles.title}>Delete {recordLabel}?</Text>
        <Text style={styles.body}>
          {linkedCount === 0
            ? 'This removes the record on this device now and queues deletion for the cloud.'
            : `${linkedCount} linked record${linkedCount === 1 ? '' : 's'} must be handled first. Cloud deletion is blocked while linked records exist.`}
        </Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}>
            <Text style={styles.cancelLabel}>Keep record</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || linkedCount > 0}
            onPress={onConfirm}
            style={[styles.delete, (busy || linkedCount > 0) && styles.disabled]}
            testID="confirm-record-delete"
          >
            <Text style={styles.deleteLabel}>{busy ? 'Deleting…' : 'Delete record'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
  )
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  backdrop: { backgroundColor: '#00000099', flex: 1, justifyContent: 'flex-end' },
  body: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  cancel: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  cancelLabel: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  delete: { alignItems: 'center', backgroundColor: colors.danger, borderRadius: radius.md, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  deleteLabel: { color: '#FFFFFF', fontFamily: typography.body, fontSize: 16, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  sheet: { backgroundColor: colors.panel, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.lg, padding: spacing.xl },
  title: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 28, fontWeight: '800' },
})
