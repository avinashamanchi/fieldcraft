import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../../src/auth/AuthProvider'
import { aiConsentStore } from '../../src/ai/consentStore'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { FormField } from '../../src/components/FormField'
import { Screen } from '../../src/components/Screen'
import type { InvoiceDraft } from '../../src/domain/entities'
import { InvoiceEditor } from '../../src/features/invoices/InvoiceEditor'
import { VoiceTranscriptInput } from '../../src/features/invoices/VoiceTranscriptInput'
import { useInvoiceSession } from '../../src/features/invoices/invoiceSession'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

const initialDraft = (): InvoiceDraft => ({
  clientName: '', jobTitle: '', tradeType: 'General', taxBasisPoints: 0,
  paymentTerms: 'Due on receipt',
  lineItems: [{ description: '', type: 'labor', quantity: 1000, unitPriceCents: 0 }],
})

const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

export const draftFromLocalJobNote = (value: string): InvoiceDraft => {
  const note = Array.from(value.trim()).slice(0, 4_000).join('')
  const client = note.match(/\bfor\s+([\p{L}\p{N} .'-]{1,80}?)(?:,|$)/iu)?.[1]?.trim() || 'Review client'
  const title = (note.split(/\bfor\b/iu)[0]?.trim() || 'Field job').slice(0, 200)
  const hoursMatch = note.match(/\b(one|two|three|four|five|six|seven|eight|\d+(?:\.\d+)?)\s+hours?\s+labor\b/iu)
  const hours = hoursMatch ? (numberWords[hoursMatch[1].toLocaleLowerCase()] ?? Number(hoursMatch[1])) : null
  const pricedItem = note.match(/(?:one|1)\s+\$(\d+(?:\.\d{1,2})?)\s+([\p{L}\p{N} .'-]{1,80})/iu)
  const lineItems = [
    ...(hours && Number.isFinite(hours) ? [{ description: 'Labor', type: 'labor' as const, quantity: Math.round(hours * 1000), unitPriceCents: 0 }] : []),
    ...(pricedItem ? [{ description: pricedItem[2].trim(), type: 'material' as const, quantity: 1000, unitPriceCents: Math.round(Number(pricedItem[1]) * 100) }] : []),
  ]
  return {
    clientName: client,
    jobTitle: title || 'Field job',
    jobDescription: note,
    tradeType: 'General',
    taxBasisPoints: 0,
    paymentTerms: 'Due on receipt',
    lineItems: lineItems.length > 0 ? lineItems : [{ description: note || 'Review job details', type: 'labor', quantity: 1000, unitPriceCents: 0 }],
  }
}

export default function NewInvoiceScreen() {
  const auth = useAuth()
  const session = useInvoiceSession()
  const [mode, setMode] = useState<'manual' | 'voice'>('manual')
  const [draft, setDraft] = useState(initialDraft)
  const [localNote, setLocalNote] = useState('')
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
        <View style={styles.manualPanel}>
          <Text style={styles.copy}>Quick local entry fills an editable draft without network or AI. Review the client, prices, and every field before saving.</Text>
          <FormField
            label="Quick local job note"
            maxLength={4_000}
            multiline
            onChangeText={(value) => { setLocalNote(value); setDraft(draftFromLocalJobNote(value)) }}
            testID="manual-job-entry"
            value={localNote}
          />
          <InvoiceEditor continueTestID="review-invoice" draft={draft} onChange={setDraft} onContinue={() => session.reviewManual(draft)} />
        </View>
      ) : (
        <View style={styles.aiPanel}>
          <VoiceTranscriptInput onChangeText={session.setTranscript} value={transcript} />
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
  manualPanel: { gap: spacing.lg },
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
