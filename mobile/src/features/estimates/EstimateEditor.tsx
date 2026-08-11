import * as Crypto from 'expo-crypto'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import { Screen } from '../../components/Screen'
import type { FieldCraftRepository } from '../../data/repository'
import type { Client, Estimate, LineItemDraft } from '../../domain/entities'
import { MAX_INVOICE_LINE_ITEMS } from '../../domain/limits'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../theme/tokens'
import { buildEstimateMutation } from './estimateCommands'
import { calculateEstimateDraft, EstimateDraftInputSchema, type EstimateDraftInput } from './estimateForm'

const emptyLine = (): LineItemDraft => ({
  description: '', type: 'labor', quantity: 1_000, unitPriceCents: 0,
})

const defaultExpiration = (): string => new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()

export const EstimateEditor = ({
  clients,
  current,
  hasMoreClients = false,
  onLoadMoreClients,
  ownerId,
  repository,
}: Readonly<{
  clients: readonly Client[]
  current?: Estimate
  hasMoreClients?: boolean
  onLoadMoreClients?: () => void
  ownerId: string
  repository: FieldCraftRepository
}>) => {
  const [draft, setDraft] = useState<EstimateDraftInput>(() => ({
    clientId: current?.clientId ?? clients[0]?.id ?? '',
    title: current?.title ?? '',
    scope: current?.scope ?? '',
    lineItems: current?.lineItems.map((line) => ({ ...line })) ?? [emptyLine()],
    taxBasisPoints: current?.taxBasisPoints ?? 0,
    expiresAt: current?.expiresAt ?? defaultExpiration(),
    ...(current?.notes === undefined ? {} : { notes: current.notes }),
  }))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const operation = useRef<ReturnType<typeof buildEstimateMutation> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const update = <K extends keyof EstimateDraftInput>(key: K, value: EstimateDraftInput[K]) => {
    operation.current = null
    setDraft((existing) => ({ ...existing, [key]: value }))
  }
  const updateLine = (index: number, patch: Partial<LineItemDraft>) => update(
    'lineItems',
    draft.lineItems.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
  )
  const parsed = EstimateDraftInputSchema.safeParse(draft)
  let total: number | null = null
  if (parsed.success) {
    try { total = calculateEstimateDraft(draft).totalCents } catch { total = null }
  }
  const save = (): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = (async () => {
      setSaving(true)
      setError(null)
      try {
        operation.current ??= buildEstimateMutation({
          current,
          draft,
          ownerId,
          estimateId: current?.id ?? Crypto.randomUUID(),
          mutationId: Crypto.randomUUID(),
          now: new Date().toISOString(),
        })
        await repository.transactLocalMutation(operation.current)
        router.replace(`/estimates/${operation.current.entityId}` as never)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'The estimate could not be saved locally.')
      } finally {
        setSaving(false)
      }
    })()
    inFlight.current = pending
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null })
    return pending
  }

  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>{current ? 'Edit estimate' : 'New estimate'}</Text>
      {clients.length === 0 ? (
        <View style={styles.notice}>
          <Text style={styles.copy}>Add a client before creating an estimate.</Text>
          <PrimaryButton label="Add client" onPress={() => router.push('/clients/new')} />
        </View>
      ) : (
        <>
          <Text style={styles.label}>Client</Text>
          <View style={styles.choices}>{clients.map((client) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: draft.clientId === client.id }}
              key={client.id}
              onPress={() => update('clientId', client.id)}
              style={[styles.choice, draft.clientId === client.id && styles.selected]}
            ><Text style={styles.choiceText}>{client.name}</Text></Pressable>
          ))}</View>
          {hasMoreClients && onLoadMoreClients ? <PrimaryButton label="Load more clients" onPress={onLoadMoreClients} /> : null}
        </>
      )}
      <FormField label="Estimate title" maxLength={200} onChangeText={(value) => update('title', value)} testID="estimate-title" value={draft.title} />
      <FormField label="Scope of work" maxLength={4_000} multiline onChangeText={(value) => update('scope', value)} testID="estimate-scope" value={draft.scope} />
      <Text accessibilityRole="header" style={styles.section}>Line items</Text>
      {draft.lineItems.map((line, index) => (
        <View key={line.id ?? `estimate-line-${index}`} style={styles.lineCard}>
          <FormField label={`Description ${index + 1}`} maxLength={500} onChangeText={(value) => updateLine(index, { description: value })} testID={`estimate-line-description-${index}`} value={line.description} />
          <View style={styles.choices}>{(['labor', 'material'] as const).map((type) => (
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: line.type === type }} key={type} onPress={() => updateLine(index, { type })} style={[styles.choice, line.type === type && styles.selected]}><Text style={styles.choiceText}>{type === 'labor' ? 'Labor' : 'Material'}</Text></Pressable>
          ))}</View>
          <FormField keyboardType="decimal-pad" label="Quantity" onChangeText={(value) => updateLine(index, { quantity: Math.round((Number(value) || 0) * 1_000) })} value={String(line.quantity / 1_000)} />
          <FormField keyboardType="decimal-pad" label="Unit price ($)" onChangeText={(value) => updateLine(index, { unitPriceCents: Math.round((Number(value) || 0) * 100) })} value={(line.unitPriceCents / 100).toFixed(2)} />
          {draft.lineItems.length > 1 ? <Pressable accessibilityRole="button" onPress={() => update('lineItems', draft.lineItems.filter((_line, lineIndex) => lineIndex !== index))} style={styles.secondary}><Text style={styles.danger}>Remove line</Text></Pressable> : null}
        </View>
      ))}
      <PrimaryButton disabled={draft.lineItems.length >= MAX_INVOICE_LINE_ITEMS} label="Add line item" onPress={() => update('lineItems', [...draft.lineItems, emptyLine()])} />
      <FormField keyboardType="decimal-pad" label="Tax rate (%)" onChangeText={(value) => update('taxBasisPoints', Math.round((Number(value) || 0) * 100))} value={(draft.taxBasisPoints / 100).toFixed(2)} />
      <FormField label="Expires (YYYY-MM-DD)" onChangeText={(value) => {
        const parsedDate = Date.parse(`${value}T23:59:59.000Z`)
        update('expiresAt', Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : value)
      }} value={draft.expiresAt.slice(0, 10)} />
      <FormField label="Notes" maxLength={4_000} multiline onChangeText={(value) => update('notes', value)} value={draft.notes ?? ''} />
      {total === null ? <Text accessibilityRole="alert" style={styles.danger}>Complete all required fields with valid amounts.</Text> : <Text accessibilityLiveRegion="polite" style={styles.total}>Estimate total ${(total / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</Text>}
      {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
      <PrimaryButton disabled={saving || total === null || clients.length === 0} label={saving ? 'Saving…' : 'Save estimate on this phone'} onPress={() => { void save() }} testID="save-estimate" />
    </Screen>
  )
}

const styles = StyleSheet.create({
  choice: { borderColor: '#444', borderRadius: radius.sm, borderWidth: 1, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choiceText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14 },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15 },
  danger: { color: colors.danger, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  label: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 14, fontWeight: '700' },
  lineCard: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.md },
  notice: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.md, padding: spacing.lg },
  screen: { gap: spacing.lg },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  section: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 24, fontWeight: '800' },
  selected: { borderColor: colors.orange },
  total: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 20, fontWeight: '800' },
})
