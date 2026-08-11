import { router } from 'expo-router'
import * as Sharing from 'expo-sharing'
import { useRef, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { requireRecentAal2, StepUpRequiredError } from '../../src/auth/requireAal2'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { createAccountExport } from '../../src/exports/accountExport'
import { colors, spacing, typography } from '../../src/theme/tokens'

export default function AccountExportScreen() {
  const { owner, repository } = useFieldCraftData()
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const share = (format: 'json' | 'csv'): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = (async () => {
      if (!owner.ownerId) return
      setBusy(format)
      setNotice(null)
      setError(null)
      let artifact: Awaited<ReturnType<typeof createAccountExport>> | null = null
      try {
        requireRecentAal2('account-export')
        artifact = await createAccountExport({
          ownerId: owner.ownerId,
          currentOwnerId: () => repository.ownerBoundary.getSnapshot().ownerId,
          requireRecentAal2: () => { requireRecentAal2('account-export') },
          repository,
        })
        if (!await Sharing.isAvailableAsync()) throw new Error('The iOS share sheet is unavailable.')
        await Sharing.shareAsync(format === 'json' ? artifact.jsonUri : artifact.csvUri, {
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          UTI: format === 'json' ? 'public.json' : 'public.comma-separated-values-text',
          dialogTitle: `Export FieldCraft ${format.toUpperCase()}`,
        })
        setNotice('Share sheet opened. FieldCraft cannot verify where the file was saved or sent.')
      } catch (cause) {
        if (cause instanceof StepUpRequiredError || (typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'AAL2_REQUIRED')) {
          router.push('/security/step-up?operation=account-export' as never)
        } else {
          setError(cause instanceof Error ? cause.message : 'The export could not be prepared securely.')
        }
      } finally {
        await artifact?.cleanup().catch(() => {})
        setBusy(null)
      }
    })()
    inFlight.current = pending
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null })
    return pending
  }
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Export your account</Text>
      <Text style={styles.copy}>Exports are available on Free, Pro, and after a downgrade. FieldCraft reads local records in pages of 50, excludes device-only receipt paths and credentials, verifies file checksums, and stops before 50 MiB.</Text>
      <Text style={styles.copy}>Authenticator verification is required because the export can contain client and business information.</Text>
      <PrimaryButton disabled={busy !== null} label={busy === 'json' ? 'Preparing JSON…' : 'Export JSON'} onPress={() => { void share('json') }} testID="export-json" />
      <PrimaryButton disabled={busy !== null} label={busy === 'csv' ? 'Preparing CSV…' : 'Export CSV'} onPress={() => { void share('csv') }} testID="export-csv" />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 23 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 32, fontWeight: '800' },
  notice: { color: colors.success, fontFamily: typography.body, fontSize: 15 },
  screen: { gap: spacing.lg },
})
