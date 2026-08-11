import { useState } from 'react'
import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native'

import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../theme/tokens'

type PrimaryButtonProps = Omit<PressableProps, 'children'> & {
  label: string
}

export const PrimaryButton = ({ disabled, label, onPressIn, onPressOut, ...props }: PrimaryButtonProps) => {
  const [pressed, setPressed] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPressIn={(event) => {
        setPressed(true)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        setPressed(false)
        onPressOut?.(event)
      }}
      style={[styles.button, pressed && styles.pressed, disabled && styles.disabled]}
      {...props}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.orange,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  disabled: { opacity: 0.5 },
  label: {
    color: colors.charcoal,
    fontFamily: typography.body,
    fontSize: 17,
    fontWeight: '800',
  },
  pressed: { backgroundColor: colors.orangePressed },
})
