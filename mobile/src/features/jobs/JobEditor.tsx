import * as Crypto from 'expo-crypto'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import { Screen } from '../../components/Screen'
import type { SQLiteFieldCraftRepository } from '../../data/sqliteRepository'
import type { Client, Job, JobStatus, TradeType } from '../../domain/entities'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../theme/tokens'
import { buildJobMutation, type JobDraft } from './jobForm'

const TRADES: TradeType[] = ['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']
const STATUSES: JobStatus[] = [
  'Scheduled', 'In Progress', 'Completed', 'Invoiced',
  'Partially Paid', 'Paid', 'Cancelled',
]

type JobEditorProps = {
  clients: Client[]
  current?: Job
  ownerId: string
  repository: SQLiteFieldCraftRepository
  onRequestDelete?: () => void
}

export const JobEditor = ({ clients, current, ownerId, repository, onRequestDelete }: JobEditorProps) => {
  const [draft, setDraft] = useState<JobDraft>({
    clientId: current?.clientId ?? clients[0]?.id ?? '',
    title: current?.title ?? '',
    tradeType: current?.tradeType ?? 'General',
    status: current?.status ?? 'Scheduled',
    address: current?.address ?? '',
    description: current?.description ?? '',
    laborHoursThousandths: current?.laborHoursThousandths ?? 0,
    laborRateCents: current?.laborRateCents ?? 0,
    notes: current?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  const update = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) => {
    setDraft((existing) => ({ ...existing, [key]: value }))
  }
  const save = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const entityId = current?.id ?? Crypto.randomUUID()
      await repository.transactLocalMutation(buildJobMutation({
        current,
        draft,
        entityId,
        mutationId: Crypto.randomUUID(),
        now: new Date().toISOString(),
        ownerId,
      }))
      router.replace('/(tabs)/jobs')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The job could not be saved locally.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <Screen contentContainerStyle={styles.form} scroll>
      <Text accessibilityRole="header" style={styles.heading}>{current ? 'Edit job' : 'New job'}</Text>
      {clients.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>Create a client before logging a job.</Text>
          <PrimaryButton label="Create client" onPress={() => router.push('/clients/new')} />
        </View>
      ) : (
        <>
          <Text style={styles.label}>Client</Text>
          <View style={styles.choices}>
            {clients.map((client) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: draft.clientId === client.id }}
                key={client.id}
                onPress={() => update('clientId', client.id)}
                style={[styles.choice, draft.clientId === client.id && styles.choiceSelected]}
              >
                <Text style={styles.choiceText}>{client.name}</Text>
              </Pressable>
            ))}
          </View>
          <FormField label="Job title" maxLength={400} onChangeText={(value) => update('title', value)} testID="job-title" value={draft.title} />
          <FormField label="Address" onChangeText={(value) => update('address', value)} value={draft.address} />
          <FormField label="Description" multiline onChangeText={(value) => update('description', value)} value={draft.description} />
          <Text style={styles.label}>Trade</Text>
          <View style={styles.choices}>{TRADES.map((trade) => (
            <Pressable key={trade} onPress={() => update('tradeType', trade)} style={[styles.choice, draft.tradeType === trade && styles.choiceSelected]}>
              <Text style={styles.choiceText}>{trade}</Text>
            </Pressable>
          ))}</View>
          <Text style={styles.label}>Status</Text>
          <View style={styles.choices}>{STATUSES.map((status) => (
            <Pressable key={status} onPress={() => update('status', status)} style={[styles.choice, draft.status === status && styles.choiceSelected]}>
              <Text style={styles.choiceText}>{status}</Text>
            </Pressable>
          ))}</View>
          <FormField keyboardType="decimal-pad" label="Labor hours" onChangeText={(value) => update('laborHoursThousandths', Math.round((Number(value) || 0) * 1000))} value={String(draft.laborHoursThousandths / 1000)} />
          <FormField keyboardType="decimal-pad" label="Labor rate ($)" onChangeText={(value) => update('laborRateCents', Math.round((Number(value) || 0) * 100))} value={(draft.laborRateCents / 100).toFixed(2)} />
          <FormField label="Notes" multiline onChangeText={(value) => update('notes', value)} value={draft.notes} />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <PrimaryButton disabled={busy} label={busy ? 'Saving…' : 'Save job'} onPress={() => { void save() }} testID="save-job" />
          {current && onRequestDelete ? (
            <Pressable accessibilityRole="button" onPress={onRequestDelete} style={styles.deleteAction}>
              <Text style={styles.deleteText}>Delete job</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  choice: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  choiceSelected: { borderColor: colors.orange },
  choiceText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  deleteAction: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  deleteText: { color: colors.danger, fontFamily: typography.body, fontSize: 16, fontWeight: '800' },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 15 },
  form: { gap: spacing.lg },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  notice: { gap: spacing.lg, paddingVertical: spacing.xl },
  noticeText: { color: colors.muted, fontFamily: typography.body, fontSize: 16 },
})
