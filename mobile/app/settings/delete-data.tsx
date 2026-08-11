import * as SecureStore from 'expo-secure-store'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { aiConsentStore } from '../../src/ai/consentStore'
import { FormField } from '../../src/components/FormField'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { tempArtifactRegistry } from '../../src/files/tempArtifactRegistry'
import { useInvoiceSession } from '../../src/features/invoices/invoiceSession'
import { clearLocalAuthentication, deleteLocalData } from '../../src/privacy/deleteLocalData'
import { colors, spacing, typography } from '../../src/theme/tokens'

const retryKey = (ownerId: string) => `fieldcraft.delete-retry.${ownerId}`

export default function DeleteLocalDataScreen() {
  const { owner, repository } = useFieldCraftData()
  const invoiceSession = useInvoiceSession()
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const deleting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const remove = async () => {
    const ownerId = owner.ownerId
    if (!ownerId || phrase !== 'DELETE' || deleting.current) return
    deleting.current = true
    setBusy(true)
    setMessage(null)
    let clearPromise: Promise<void> | null = null
    const clearRepository = () => { clearPromise ??= repository.clearOwner(ownerId); return clearPromise }
    const outcome = await deleteLocalData(ownerId, {
      clearVisibleMemory: () => { invoiceSession.reset(); repository.ownerBoundary.beginDelete(ownerId) },
      clearRepository,
      clearOutbox: clearRepository,
      clearConflicts: clearRepository,
      clearAuth: clearLocalAuthentication,
      clearConsent: () => aiConsentStore.revoke(ownerId),
      clearArtifacts: async () => { await tempArtifactRegistry.cleanupRegistered(); await tempArtifactRegistry.cleanupOwnedDirectories() },
      setRetryMarker: (id, failed) => SecureStore.setItemAsync(retryKey(id), JSON.stringify({ version: 1, failed })),
      clearRetryMarker: (id) => SecureStore.deleteItemAsync(retryKey(id)),
    })
    if (!mounted.current) return
    if (outcome.ok) {
      setMessage('Local FieldCraft data was deleted from this device.')
      router.replace('/(auth)/login')
    } else {
      setMessage(`Deletion is incomplete. Retry these local areas: ${outcome.failed.join(', ')}.`)
    }
    deleting.current = false
    setBusy(false)
  }
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Delete local data</Text>
      <Text style={styles.copy}>This clears the offline cache, queued changes, conflicts, session, AI consent, and temporary files on this device. It does not delete the cloud account.</Text>
      <Text style={styles.warning}>Type DELETE exactly to continue.</Text>
      <FormField autoCapitalize="characters" label="Confirmation" onChangeText={setPhrase} testID="delete-data-phrase" value={phrase} />
      <PrimaryButton disabled={phrase !== 'DELETE' || busy} label={busy ? 'Deleting…' : 'Delete local data'} onPress={() => { void remove() }} testID="confirm-delete-data" />
      {message ? <Text accessibilityRole="alert" style={styles.warning}>{message}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  screen: { gap: spacing.lg },
  warning: { color: colors.danger, fontFamily: typography.body, fontSize: 15, fontWeight: '700' },
})
