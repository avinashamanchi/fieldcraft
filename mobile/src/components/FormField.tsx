import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../theme/tokens'

type FormFieldProps = TextInputProps & { label: string }

export const FormField = ({ label, ...props }: FormFieldProps) => (
  <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={props.accessibilityLabel ?? label}
      placeholderTextColor={colors.muted}
      style={[styles.input, props.multiline && styles.multiline]}
      {...props}
    />
  </View>
)

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    backgroundColor: colors.panel,
    borderColor: '#3A3A3A',
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.warmWhite,
    fontFamily: typography.body,
    fontSize: 16,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  multiline: { minHeight: 104, textAlignVertical: 'top' },
})
