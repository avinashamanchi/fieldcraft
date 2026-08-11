import * as Crypto from 'expo-crypto'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { ErrorState } from '../../src/components/ErrorState'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client, Estimate } from '../../src/domain/entities'
import {
  buildAcceptEstimateMutation,
  buildConvertEstimateMutation,
  buildIssueEstimateMutation,
} from '../../src/features/estimates/estimateCommands'
import { EstimateEditor } from '../../src/features/estimates/EstimateEditor'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

type Detail = { estimate: Estimate; client: Client | null }

export default function EstimateDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>()
  const { owner, repository } = useFieldCraftData()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const action = useRef<Promise<void> | null>(null)
  const load = useCallback(async () => {
    const estimate = await repository.get<Estimate>('estimate', id)
    if (!estimate) { setMissing(true); return }
    setDetail({ estimate, client: await repository.get<Client>('client', estimate.clientId) })
  }, [id, repository])
  useEffect(() => {
    const guardedLoad = async () => {
      try { await load() }
      catch { setError('The estimate could not be loaded securely from this device.') }
    }
    void guardedLoad()
    return repository.subscribeToLocalMutations(() => { void guardedLoad() })
  }, [load, repository])
  const run = (build: () => Parameters<typeof repository.transactLocalMutation>[0]): Promise<void> => {
    if (action.current) return action.current
    const pending = (async () => {
      setBusy(true)
      setError(null)
      try { await repository.transactLocalMutation(build()) }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'The estimate action could not be saved locally.') }
      finally { setBusy(false) }
    })()
    action.current = pending
    void pending.finally(() => { if (action.current === pending) action.current = null })
    return pending
  }
  if (missing) return <Screen><ErrorState message="This estimate is no longer available." /></Screen>
  if (!detail) return <Screen><ActivityIndicator color={colors.orange} />{error ? <><Text accessibilityRole="alert" style={styles.error}>{error}</Text><PrimaryButton label="Try again" onPress={() => { void load() }} /></> : null}</Screen>
  const { estimate, client } = detail
  if (edit === '1' && owner.ownerId) {
    return <EstimateEditor clients={client ? [client] : []} current={estimate} ownerId={owner.ownerId} repository={repository} />
  }
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text style={styles.eyebrow}>{estimate.number ?? 'DRAFT'} · {estimate.syncState.toUpperCase()}</Text>
      <Text accessibilityRole="header" style={styles.heading}>{estimate.title}</Text>
      <Text style={styles.client}>{client?.name ?? 'Client unavailable'} · {estimate.status}</Text>
      <View style={styles.card}>
        <Text style={styles.scope}>{estimate.scope}</Text>
        {estimate.lineItems.map((line, index) => (
          <View key={line.id ?? `${line.description}-${index}`} style={styles.line}>
            <Text style={styles.scope}>{line.description}</Text>
            <Text style={styles.amount}>${(Math.round(line.quantity * line.unitPriceCents / 1_000) / 100).toFixed(2)}</Text>
          </View>
        ))}
        <Text style={styles.total}>Total ${(estimate.totalCents / 100).toFixed(2)}</Text>
      </View>
      {estimate.status === 'Draft' ? <>
        <PrimaryButton disabled={busy} label="Edit draft" onPress={() => router.push(`/estimates/${estimate.id}?edit=1` as never)} />
        <PrimaryButton disabled={busy} label={busy ? 'Issuing…' : 'Issue estimate'} onPress={() => { void run(() => buildIssueEstimateMutation({ estimate, mutationId: Crypto.randomUUID(), issuedAt: new Date().toISOString() })) }} testID="issue-estimate" />
      </> : null}
      {estimate.status === 'Issued' ? <>
        <Text style={styles.copy}>Acceptance is recorded by the signed-in business owner. This is not a customer e-signature.</Text>
        <PrimaryButton disabled={busy} label={busy ? 'Recording…' : 'Record customer acceptance'} onPress={() => { void run(() => buildAcceptEstimateMutation({ estimate, mutationId: Crypto.randomUUID(), acceptedAt: new Date().toISOString() })) }} testID="accept-estimate" />
      </> : null}
      {estimate.status === 'Accepted' ? <PrimaryButton disabled={busy} label={busy ? 'Converting…' : 'Convert once to a job'} onPress={() => { void run(() => buildConvertEstimateMutation({ estimate, mutationId: Crypto.randomUUID(), jobId: Crypto.randomUUID(), now: new Date().toISOString() })) }} testID="convert-estimate" /> : null}
      {estimate.status === 'Converted' && estimate.convertedJobId ? <>
        <PrimaryButton label="Open converted job" onPress={() => router.push(`/jobs/${estimate.convertedJobId}` as never)} />
        <PrimaryButton label="Create invoice from estimate" onPress={() => router.push(`/invoices/new?estimateId=${estimate.id}` as never)} />
      </> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {estimate.notes ? <Text style={styles.copy}>{estimate.notes}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)/estimates' as never)} style={styles.secondary}><Text style={styles.secondaryText}>Back to estimates</Text></Pressable>
    </Screen>
  )
}

const styles = StyleSheet.create({
  amount: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 14 },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  client: { color: colors.muted, fontFamily: typography.body, fontSize: 18 },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  eyebrow: { color: colors.orange, fontFamily: typography.utility, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  line: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  scope: { color: colors.warmWhite, flex: 1, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  screen: { gap: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  secondaryText: { color: colors.orange, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  total: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 20, fontWeight: '800', textAlign: 'right' },
})
