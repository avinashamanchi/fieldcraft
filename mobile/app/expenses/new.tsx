import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { aiConsentStore } from '../../src/ai/consentStore'
import { useAuth } from '../../src/auth/AuthProvider'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Job } from '../../src/domain/entities'
import { importReceiptImage } from '../../src/files/imageImport'
import { ExpenseEditor, suggestExpenseCategory } from '../../src/features/expenses/ExpenseEditor'
import { parseReceipt, type ExpenseDraft } from '../../src/features/expenses/receiptParser'
import { visionPort } from '../../src/native/vision'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

const initialDraft = (): ExpenseDraft => ({ vendor: '', amountCents: 0, category: 'Other', expenseDate: new Date().toISOString().slice(0, 10), notes: '' })

export default function NewExpenseScreen() {
  const auth = useAuth()
  const { owner, repository } = useFieldCraftData()
  const [draft, setDraft] = useState(initialDraft)
  const [jobs, setJobs] = useState<Job[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [confidence, setConfidence] = useState<number | null>(null)
  const [consentPrompt, setConsentPrompt] = useState(false)
  const ownerId = auth.status === 'signedIn' && owner.ownerId === auth.userId ? auth.userId : null

  useEffect(() => { void repository.list<Job>('job').then(setJobs).catch(() => setJobs([])) }, [repository])

  const importFrom = async (source: 'camera' | 'library') => {
    setScanMessage(null)
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) { setScanMessage('Permission was not granted. Manual entry remains available.'); return }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: true })
    if (result.canceled || !result.assets[0]) return
    setScanning(true)
    let imported: Awaited<ReturnType<typeof importReceiptImage>> | null = null
    try {
      imported = await importReceiptImage({ uri: result.assets[0].uri, mimeType: result.assets[0].mimeType })
      if (imported.cancelled) return
      const parsed = parseReceipt(await visionPort.recognize(imported.uri))
      setDraft(parsed)
      setConfidence(parsed.confidence)
      setScanMessage(parsed.manualReviewRequired
        ? 'Low-confidence scan: review every field before saving.'
        : 'Receipt fields were extracted on this device. Review before saving.')
    } catch {
      setScanMessage('Receipt scanning is unavailable or the image was unsafe. Enter the expense manually.')
    } finally {
      if (imported && !imported.cancelled) await imported.cleanup().catch(() => {})
      setScanning(false)
    }
  }

  const categorize = async () => {
    if (!ownerId) return
    if (!await aiConsentStore.hasConsent(ownerId)) { setConsentPrompt(true); return }
    const category = await suggestExpenseCategory(draft, ownerId)
    setDraft((current) => ({ ...current, category }))
  }
  const allowCategory = async () => {
    if (!ownerId) return
    await aiConsentStore.grant(ownerId)
    setConsentPrompt(false)
    await categorize()
  }

  if (!ownerId) return <Screen><Text accessibilityRole="alert" style={styles.error}>Sign in again before saving an expense.</Text></Screen>
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>NEW EXPENSE</Text>
      <Text accessibilityRole="header" style={styles.heading}>Keep the receipt review in your hands.</Text>
      <Text style={styles.copy}>Scan on this device or enter fields manually. The raw receipt image is deleted after extraction and is never sent to the AI provider.</Text>
      <View style={styles.actions}>
        <PrimaryButton disabled={scanning} label={scanning ? 'Scanning…' : 'Use camera'} onPress={() => { void importFrom('camera') }} />
        <PrimaryButton disabled={scanning} label="Choose photo" onPress={() => { void importFrom('library') }} />
      </View>
      {scanMessage ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{scanMessage}</Text> : null}
      {confidence !== null ? <Text style={styles.confidence}>OCR confidence · {Math.round(confidence * 100)}%</Text> : null}
      <ExpenseEditor draft={draft} jobs={jobs} onChange={setDraft} onSaved={() => router.replace('/(tabs)/expenses' as never)} ownerId={ownerId} repository={repository} />
      <PrimaryButton label="Suggest category with AI" onPress={() => { void categorize() }} />
      {consentPrompt ? (
        <View style={styles.consent}>
          <Text style={styles.consentTitle}>Send only vendor, amount, and reviewed notes?</Text>
          <Text style={styles.copy}>The image and full OCR text are never included.</Text>
          <PrimaryButton label="Allow category suggestion" onPress={() => { void allowCategory() }} />
          <Pressable accessibilityRole="button" onPress={() => { setConsentPrompt(false); setDraft((current) => ({ ...current, category: 'Other' })) }} style={styles.secondary}><Text style={styles.secondaryText}>Not now · keep Other</Text></Pressable>
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm },
  confidence: { color: colors.orange, fontFamily: typography.utility, fontSize: 12 },
  consent: { backgroundColor: colors.panel, borderColor: colors.orange, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  consentTitle: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 18, fontWeight: '800' },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 15 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  notice: { color: colors.warning, fontFamily: typography.body, fontSize: 14 },
  screen: { gap: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  secondaryText: { color: colors.orange, fontFamily: typography.body, fontWeight: '700' },
})
