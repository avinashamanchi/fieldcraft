import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { aiConsentStore } from '../../src/ai/consentStore'
import { FormField } from '../../src/components/FormField'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { useSubscription } from '../../src/billing/SubscriptionProvider'
import { tempArtifactRegistry } from '../../src/files/tempArtifactRegistry'
import { useInvoiceSession } from '../../src/features/invoices/invoiceSession'
import { getDeleteAccountClient } from '../../src/privacy/deleteAccount'
import { clearLocalAuthentication, deleteLocalData, type DeleteOutcome } from '../../src/privacy/deleteLocalData'
import { requireRecentAal2 } from '../../src/auth/requireAal2'
import { getOwnerErasureRegistry } from '../../src/auth/ownerErasureRegistry'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

type DeleteAccountControlProps = {
  deleteCloud(): Promise<void>
  deleteLocal(): Promise<DeleteOutcome>
  onComplete?: () => void
  requireRecentVerification?: () => void
}

export const DeleteAccountControl = ({ deleteCloud, deleteLocal, onComplete, requireRecentVerification = () => {} }: DeleteAccountControlProps) => {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const running = useRef(false)
  const cloudDeleted = useRef(false)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const remove = async () => {
    if (phrase !== 'DELETE MY ACCOUNT' || running.current) return
    running.current = true
    if (mounted.current) { setBusy(true); setMessage(null) }
    try {
      if (!cloudDeleted.current) {
        try {
          requireRecentVerification()
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'STEP_UP_REQUIRED') {
            if (mounted.current) setMessage('Please verify with your authenticator, then return and press Delete my account again.')
            router.push('/security/step-up?operation=delete-account' as never)
            return
          }
          throw error
        }
        await deleteCloud()
        cloudDeleted.current = true
      }
      const local = await deleteLocal()
      if (!mounted.current) return
      if (local.ok) {
        setMessage('Account deleted and local data cleared.')
        onComplete?.()
      } else {
        setMessage(`The account was deleted, but local cleanup is incomplete: ${local.failed.join(', ')}. Press delete again to retry local cleanup.`)
      }
    } catch {
      if (mounted.current) setMessage('The account was not deleted. Sign in again and retry.')
    } finally {
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <View style={styles.control}>
      <Text style={styles.copy}>This permanently deletes the authenticated Supabase account, synced business records, and owner-scoped logo, then clears local data.</Text>
      <Text style={styles.warning}>Type DELETE MY ACCOUNT exactly.</Text>
      <FormField autoCapitalize="characters" label="Confirmation" onChangeText={setPhrase} testID="delete-account-phrase" value={phrase} />
      <PrimaryButton disabled={phrase !== 'DELETE MY ACCOUNT' || busy} label={busy ? 'Deleting account…' : 'Delete my account'} onPress={() => { void remove() }} testID="confirm-delete-account" />
      {message ? <Text accessibilityRole="alert" style={styles.warning}>{message}</Text> : null}
    </View>
  )
}

export default function DeleteAccountScreen() {
  const { owner, repository } = useFieldCraftData()
  const invoiceSession = useInvoiceSession()
  const { clearLocalEntitlement } = useSubscription()
  const ownerId = owner.ownerId
  if (!ownerId) return <Screen><Text accessibilityRole="alert" style={styles.copy}>Sign in again before deleting this account.</Text></Screen>
  let clearPromise: Promise<void> | null = null
  const clearRepository = () => { clearPromise ??= repository.clearOwner(ownerId); return clearPromise }
  const clearLocal = () => deleteLocalData(ownerId, {
    clearVisibleMemory: () => { invoiceSession.reset(); repository.ownerBoundary.beginDelete(ownerId) },
    clearRepository,
    clearOutbox: clearRepository,
    clearQuarantine: clearRepository,
    clearConflicts: clearRepository,
    clearAuth: clearLocalAuthentication,
    clearEntitlement: async () => { clearLocalEntitlement() },
    clearStripeLinks: clearRepository,
    clearReminders: clearRepository,
    clearConsent: () => aiConsentStore.revoke(ownerId),
    clearArtifacts: async () => { await tempArtifactRegistry.cleanupRegistered(); await tempArtifactRegistry.cleanupOwnedDirectories() },
    setRetryMarker: (id) => getOwnerErasureRegistry().mark(id),
    clearRetryMarker: (id) => getOwnerErasureRegistry().clear(id),
  })
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Delete account</Text>
      <DeleteAccountControl
        deleteCloud={() => getDeleteAccountClient().deleteAccount()}
        deleteLocal={clearLocal}
        onComplete={() => router.replace('/(auth)/login')}
        requireRecentVerification={() => { requireRecentAal2('delete-account') }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  control: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.lg, padding: spacing.lg },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  screen: { gap: spacing.lg },
  warning: { color: colors.danger, fontFamily: typography.body, fontSize: 15, fontWeight: '700' },
})
