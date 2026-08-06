import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../../src/auth/AuthProvider'
import { aiConsentStore } from '../../src/ai/consentStore'
import { FormField } from '../../src/components/FormField'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import type { InvoiceDraft } from '../../src/domain/entities'
import { InvoiceEditor } from '../../src/features/invoices/InvoiceEditor'
import { useInvoiceSession } from '../../src/features/invoices/invoiceSession'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

const initialDraft = (): InvoiceDraft => ({
  clientName: '', jobTitle: '', tradeType: 'General', taxBasisPoints: 0,
  paymentTerms: 'Due on receipt',
  lineItems: [{ description: '', type: 'labor', quantity: 1000, unitPriceCents: 0 }],
})

export default function NewInvoiceScreen() {
  const auth = useAuth()
  const session = useInvoiceSession()
  const [mode, setMode] = useState<'manual' | 'voice'>('manual')
  const [draft, setDraft] = useState(initialDraft)
  const [consentPrompt, setConsentPrompt] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const ownerId = auth.status === 'signedIn' ? auth.userId : null

  useEffect(() => {
    if (session.state.step === 'review') router.replace('/invoices/review' as never)
  }, [session.state])

  const analyze = async () => {
    if (!ownerId || session.state.step !== 'entry' || !session.state.transcript.trim()) return
    if (!await aiConsentStore.hasConsent(ownerId)) {
      setConsentPrompt(true)
      return
    }
    await session.parseTranscript(session.state.transcript.trim())
  }

  const allowAndAnalyze = async () => {
    if (!ownerId || session.state.step !== 'entry') return
    await aiConsentStore.grant(ownerId)
    setConsentPrompt(false)
    await session.parseTranscript(session.state.transcript.trim())
  }

  const transcript = session.state.step === 'entry' || session.state.step === 'parsing' ? session.state.transcript : ''
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>NEW FIELD DOCKET</Text>
      <Text accessibilityRole="header" style={styles.heading}>Turn the job into an invoice.</Text>
      <Text style={styles.copy}>Type every field yourself, or enter a transcript for an optional AI draft. Nothing is saved until review.</Text>
      <View style={styles.modes}>
        {(['manual', 'voice'] as const).map((choice) => (
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: mode === choice }} key={choice} onPress={() => { setMode(choice); session.reset(choice) }} style={[styles.mode, mode === choice && styles.modeSelected]}>
            <Text style={styles.modeText}>{choice === 'manual' ? 'Type manually' : 'Analyze transcript'}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'manual' ? (
        <InvoiceEditor draft={draft} onChange={setDraft} onContinue={() => session.reviewManual(draft)} />
      ) : (
        <View style={styles.aiPanel}>
          <FormField
            editable={session.state.step !== 'parsing'}
            label="Job transcript"
            maxLength={20_000}
            multiline
            onChangeText={session.setTranscript}
            placeholder="Example: Replaced the kitchen shutoff valve for Mina…"
            testID="invoice-transcript"
            value={transcript}
          />
          <Text style={styles.preview}>Preview only · {Array.from(transcript).length.toLocaleString()} / 20,000 characters</Text>
          {consentPrompt ? (
            <View accessibilityLabel="AI consent request" style={styles.consent}>
              <Text style={styles.consentTitle}>Send these job details for AI analysis?</Text>
              <Text style={styles.copy}>Only this transcript and invoice defaults are sent. Contact lists, receipts, tokens, and unrelated records are not included.</Text>
              <PrimaryButton label="Allow and analyze" onPress={() => { void allowAndAnalyze() }} />
              <Pressable accessibilityRole="button" onPress={() => { setConsentPrompt(false); setNotice('Nothing was sent. You can keep typing the invoice manually.') }} style={styles.secondary}><Text style={styles.secondaryText}>Not now</Text></Pressable>
            </View>
          ) : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
          {session.state.step === 'error' ? <Text accessibilityRole="alert" style={styles.error}>AI could not create a safe draft. Your transcript remains available; use manual entry or try again.</Text> : null}
          <PrimaryButton disabled={!transcript.trim() || session.state.step === 'parsing'} label={session.state.step === 'parsing' ? 'Analyzing…' : 'Analyze for a draft'} onPress={() => { void analyze() }} testID="analyze-transcript" />
          <Pressable accessibilityRole="button" onPress={() => setMode('manual')} style={styles.secondary}><Text style={styles.secondaryText}>Continue manually</Text></Pressable>
        </View>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  aiPanel: { gap: spacing.lg },
  consent: { backgroundColor: colors.panel, borderColor: colors.orange, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  consentTitle: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 18, fontWeight: '800' },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  mode: { alignItems: 'center', borderColor: '#444', borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, padding: spacing.md },
  modeSelected: { borderColor: colors.orange },
  modeText: { color: colors.warmWhite, fontFamily: typography.body, fontWeight: '700' },
  modes: { flexDirection: 'row', gap: spacing.sm },
  notice: { color: colors.success, fontFamily: typography.body, fontSize: 14 },
  preview: { color: colors.muted, fontFamily: typography.utility, fontSize: 12 },
  screen: { gap: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  secondaryText: { color: colors.orange, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
})
