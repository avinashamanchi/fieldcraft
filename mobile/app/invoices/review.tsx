import { router } from 'expo-router'
import { Pressable, StyleSheet, Text } from 'react-native'

import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { InvoiceEditor } from '../../src/features/invoices/InvoiceEditor'
import { useInvoiceSession } from '../../src/features/invoices/invoiceSession'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../src/theme/tokens'

const errorCopy = {
  'ai-consent-required': 'AI consent is required before anything is sent.',
  'ai-invalid-response': 'The AI response did not match the invoice contract.',
  'ai-unavailable': 'AI is unavailable. Manual invoice entry still works.',
  'local-save-failed': 'The invoice could not be saved locally. Your draft and retry identity were retained.',
  'owner-unavailable': 'Sign in again before saving this invoice.',
} as const

export default function InvoiceReviewScreen() {
  const session = useInvoiceSession()
  const { state } = session
  if (state.step === 'complete') {
    return (
      <Screen contentContainerStyle={styles.screen}>
        <Text accessibilityRole="header" style={styles.heading}>Saved on this phone.</Text>
        <Text style={styles.copy}>The invoice is queued for secure sync. You can keep working offline.</Text>
        <PrimaryButton label="View invoice" onPress={() => router.replace(`/invoices/${state.ids.invoiceId}` as never)} />
        <PrimaryButton label="Back to dashboard" onPress={() => { session.reset(); router.replace('/(tabs)' as never) }} />
      </Screen>
    )
  }
  const draft = state.step === 'review' || state.step === 'saving' ? state.draft : state.step === 'error' ? state.draft : null
  if (!draft) {
    return (
      <Screen contentContainerStyle={styles.screen}>
        <Text accessibilityRole="header" style={styles.heading}>No invoice draft to review.</Text>
        {state.step === 'error' ? <Text accessibilityRole="alert" style={styles.error}>{errorCopy[state.code]}</Text> : null}
        <PrimaryButton label="Start an invoice" onPress={() => { session.reset(); router.replace('/invoices/new' as never) }} />
      </Screen>
    )
  }
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>REVIEW BEFORE SAVE</Text>
      <Text accessibilityRole="header" style={styles.heading}>Every field stays editable.</Text>
      {state.step === 'error' ? <Text accessibilityRole="alert" style={styles.error}>{errorCopy[state.code]}</Text> : null}
      <InvoiceEditor
        continueLabel="Save invoice on this phone"
        draft={draft}
        onChange={session.editDraft}
        onContinue={() => { void session.save() }}
        saving={state.step === 'saving'}
      />
      <Pressable accessibilityRole="button" onPress={() => { session.cancel(); router.replace('/invoices/new' as never) }} style={styles.secondary}><Text style={styles.secondaryText}>Cancel and return</Text></Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  screen: { gap: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  secondaryText: { color: colors.danger, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
})
