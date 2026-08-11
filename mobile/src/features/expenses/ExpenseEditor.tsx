import * as Crypto from 'expo-crypto'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { z } from 'zod'

import { getAiClient } from '../../ai/aiClient'
import { AI_CONSENT_VERSION, type ExpenseCategorizeRequestV1 } from '../../ai/contracts'
import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import type { Expense, ExpenseCategory, Job } from '../../domain/entities'
import type { MutationEnvelope } from '../../domain/sync'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../theme/tokens'
import type { ExpenseDraft } from './receiptParser'

const CATEGORIES: ExpenseCategory[] = ['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other']
const ExpenseDraftSchema = z.object({
  vendor: z.string().trim().min(1).max(200),
  amountCents: z.number().finite().int().min(0).max(100_000_000),
  category: z.enum(CATEGORIES),
  expenseDate: z.iso.date(),
  notes: z.string().max(4000),
  jobId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
}).strict()

type ExpenseMutationInput = {
  current?: Expense
  entityId: string
  mutationId: string
  now: string
  ownerId: string
}

export const buildExpenseMutation = (rawDraft: ExpenseDraft, input: ExpenseMutationInput): MutationEnvelope => {
  const draft = ExpenseDraftSchema.parse(rawDraft)
  const expense: Expense = {
    id: input.entityId, ownerId: input.ownerId, vendor: draft.vendor,
    amountCents: draft.amountCents, category: draft.category, expenseDate: draft.expenseDate,
    notes: draft.notes || undefined, jobId: draft.jobId, clientId: draft.clientId,
    receiptPath: undefined,
    version: input.current?.version ?? 1,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now, syncState: 'pending',
  }
  return {
    id: input.mutationId, ownerId: input.ownerId, entity: 'expense', entityId: input.entityId,
    kind: input.current ? 'update' : 'create', baseVersion: input.current?.version ?? null,
    payload: expense, createdAt: input.now, attempts: 0,
  }
}

type CategorizationClient = { request(ownerId: string, request: ExpenseCategorizeRequestV1): Promise<{ category: ExpenseCategory }> }
const defaultCategorizationClient: CategorizationClient = {
  request: (ownerId, request) => getAiClient().request(ownerId, request),
}
const codePoints = (value: string, maximum: number): string => Array.from(value).slice(0, maximum).join('')

export const suggestExpenseCategory = async (
  draft: ExpenseDraft,
  ownerId: string,
  client: CategorizationClient = defaultCategorizationClient,
): Promise<ExpenseCategory> => {
  try {
    const result = await client.request(ownerId, {
      route: 'expense.categorize.v1', consentVersion: AI_CONSENT_VERSION,
      vendor: codePoints(draft.vendor, 120), amountCents: draft.amountCents,
      notes: codePoints(draft.notes, 500),
    })
    return CATEGORIES.includes(result.category) ? result.category : 'Other'
  } catch {
    return 'Other'
  }
}

type ExpenseEditorProps = {
  draft?: ExpenseDraft
  initialDraft?: ExpenseDraft
  jobs: Job[]
  onChange?: (draft: ExpenseDraft) => void
  onSaved?: (expenseId: string) => void
  ownerId: string
  repository: { transactLocalMutation(mutation: MutationEnvelope): Promise<void> }
}

const blankDraft = (): ExpenseDraft => ({ vendor: '', amountCents: 0, category: 'Other', expenseDate: new Date().toISOString().slice(0, 10), notes: '' })

export const ExpenseEditor = ({ draft: controlledDraft, initialDraft, jobs, onChange, onSaved, ownerId, repository }: ExpenseEditorProps) => {
  const [internalDraft, setInternalDraft] = useState<ExpenseDraft>(() => initialDraft ?? blankDraft())
  const draft = controlledDraft ?? internalDraft
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitting = useRef(false)
  const updateDraft = (next: ExpenseDraft) => {
    if (controlledDraft === undefined) setInternalDraft(next)
    onChange?.(next)
  }
  const update = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) => updateDraft({ ...draft, [key]: value })
  const save = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    const entityId = Crypto.randomUUID()
    try {
      await repository.transactLocalMutation(buildExpenseMutation(draft, {
        ownerId, entityId, mutationId: Crypto.randomUUID(), now: new Date().toISOString(),
      }))
      onSaved?.(entityId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The expense could not be saved locally.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const valid = ExpenseDraftSchema.safeParse(draft).success
  return (
    <View style={styles.form}>
      <FormField label="Vendor" maxLength={200} onChangeText={(value) => update('vendor', value)} testID="expense-vendor" value={draft.vendor} />
      <FormField keyboardType="decimal-pad" label="Amount ($)" onChangeText={(value) => update('amountCents', Math.round((Number(value) || 0) * 100))} testID="expense-amount" value={(draft.amountCents / 100).toFixed(2)} />
      <FormField label="Date (YYYY-MM-DD)" maxLength={10} onChangeText={(value) => update('expenseDate', value)} testID="expense-date" value={draft.expenseDate} />
      <Text style={styles.label}>Category</Text>
      <View style={styles.choices}>{CATEGORIES.map((category) => (
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.category === category }} key={category} onPress={() => update('category', category)} style={[styles.choice, draft.category === category && styles.selected]}><Text style={styles.choiceText}>{category}</Text></Pressable>
      ))}</View>
      {jobs.length > 0 ? (
        <>
          <Text style={styles.label}>Link to job (optional)</Text>
          <View style={styles.choices}>
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: !draft.jobId }} onPress={() => updateDraft({ ...draft, jobId: undefined, clientId: undefined })} style={[styles.choice, !draft.jobId && styles.selected]}><Text style={styles.choiceText}>No job</Text></Pressable>
            {jobs.map((job) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: draft.jobId === job.id }} key={job.id} onPress={() => updateDraft({ ...draft, jobId: job.id, clientId: job.clientId })} style={[styles.choice, draft.jobId === job.id && styles.selected]}><Text style={styles.choiceText}>{job.title}</Text></Pressable>)}
          </View>
        </>
      ) : null}
      <FormField label="Notes" maxLength={4000} multiline onChangeText={(value) => update('notes', value)} value={draft.notes} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={!valid || busy} label={busy ? 'Saving…' : 'Save expense on this phone'} onPress={() => { void save() }} testID="save-expense" />
    </View>
  )
}

const styles = StyleSheet.create({
  choice: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choiceText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  form: { gap: spacing.lg },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  selected: { borderColor: colors.orange },
})
