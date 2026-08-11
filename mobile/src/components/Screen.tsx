import type { PropsWithChildren } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors, spacing } from '../theme/tokens'

type ScreenProps = PropsWithChildren<{
  contentContainerStyle?: StyleProp<ViewStyle>
  scroll?: boolean
  testID?: string
}>

export const Screen = ({ children, contentContainerStyle, scroll = false, testID }: ScreenProps) => {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, contentContainerStyle]} testID={testID}>{children}</View>
  )

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: spacing.lg },
  keyboard: { flex: 1 },
  safeArea: { backgroundColor: colors.charcoal, flex: 1 },
})
