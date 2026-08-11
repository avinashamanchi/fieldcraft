import * as Crypto from 'expo-crypto'
import { router } from 'expo-router'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'

import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import { Screen } from '../../components/Screen'
import type { SQLiteFieldCraftRepository } from '../../data/sqliteRepository'
import type { Client } from '../../domain/entities'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../theme/tokens'
import { buildClientMutation, type ClientDraft } from './clientForm'

type ClientEditorProps = {
  current?: Client
  ownerId: string
  repository: SQLiteFieldCraftRepository
  onRequestDelete?: () => void
}

export const ClientEditor = ({ current, ownerId, repository, onRequestDelete }: ClientEditorProps) => {
  const [draft, setDraft] = useState<ClientDraft>({
    name: current?.name ?? '', phone: current?.phone ?? '', email: current?.email ?? '',
    address: current?.address ?? '', city: current?.city ?? '', state: current?.state ?? '',
    postalCode: current?.postalCode ?? '', notes: current?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const update = <K extends keyof ClientDraft>(key: K, value: ClientDraft[K]) => {
    setDraft((existing) => ({ ...existing, [key]: value }))
  }
  const save = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      await repository.transactLocalMutation(buildClientMutation({
        current, draft, entityId: current?.id ?? Crypto.randomUUID(),
        mutationId: Crypto.randomUUID(), now: new Date().toISOString(), ownerId,
      }))
      router.replace('/(tabs)/clients')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The client could not be saved locally.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <Screen contentContainerStyle={styles.form} scroll>
      <Text accessibilityRole="header" style={styles.heading}>{current ? 'Edit client' : 'New client'}</Text>
      <FormField label="Name" onChangeText={(value) => update('name', value)} testID="client-name" value={draft.name} />
      <FormField keyboardType="phone-pad" label="Phone" onChangeText={(value) => update('phone', value)} value={draft.phone} />
      <FormField autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={(value) => update('email', value)} value={draft.email} />
      <FormField label="Address" onChangeText={(value) => update('address', value)} value={draft.address} />
      <FormField label="City" onChangeText={(value) => update('city', value)} value={draft.city} />
      <FormField label="State" onChangeText={(value) => update('state', value)} value={draft.state} />
      <FormField label="Postal code" onChangeText={(value) => update('postalCode', value)} value={draft.postalCode} />
      <FormField label="Notes" multiline onChangeText={(value) => update('notes', value)} value={draft.notes} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={busy} label={busy ? 'Saving…' : 'Save client'} onPress={() => { void save() }} testID="save-client" />
      {current && onRequestDelete ? (
        <Pressable accessibilityRole="button" onPress={onRequestDelete} style={styles.deleteAction}>
          <Text style={styles.deleteText}>Delete client</Text>
        </Pressable>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 15 },
  deleteAction: { alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
  deleteText: { color: colors.danger, fontFamily: typography.body, fontSize: 16, fontWeight: '800' },
  form: { gap: spacing.lg },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
})
