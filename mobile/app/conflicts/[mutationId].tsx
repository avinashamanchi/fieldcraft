import { useEffect, useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { ConflictRecord } from '../../src/domain/sync'
import {
  createConflictResolutionCommands,
  type ConflictResolutionCommands,
  type ConflictResolutionRepository,
} from '../../src/data/syncCoordinator'
import { useConflictResolutionCommands } from '../../src/data/SyncProvider'

type ConflictResolutionViewProps = {
  conflict: ConflictRecord
  onKeepCloud(): Promise<void>
  onApplyMyEdit(): Promise<void>
}

const TECHNICAL_FIELDS = new Set([
  'id',
  'ownerId',
  'version',
  'createdAt',
  'updatedAt',
  'syncState',
])

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

export const ConflictResolutionView = ({
  conflict,
  onKeepCloud,
  onApplyMyEdit,
}: ConflictResolutionViewProps) => {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const local = asRecord(conflict.localPayload)
  const cloud = asRecord(conflict.cloudPayload)
  const fields = [...new Set([...Object.keys(local), ...Object.keys(cloud)])]
    .filter((field) => !TECHNICAL_FIELDS.has(field))
    .sort()

  const submit = async (action: () => Promise<void>) => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await action()
    } catch {
      setError('This conflict could not be resolved. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>Resolve conflict</Text>
      <Text style={styles.description}>
        Compare your offline edit with the current cloud version before choosing.
      </Text>
      {fields.map((field) => (
        <View key={field} style={styles.fieldCard}>
          <Text style={styles.fieldName}>{field}</Text>
          <View style={styles.comparison}>
            <View style={styles.valueColumn}>
              <Text style={styles.valueLabel}>My edit</Text>
              <Text>{displayValue(local[field])}</Text>
            </View>
            <View style={styles.valueColumn}>
              <Text style={styles.valueLabel}>Cloud</Text>
              <Text>{displayValue(cloud[field])}</Text>
            </View>
          </View>
        </View>
      ))}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Keep cloud"
        disabled={submitting}
        onPress={() => void submit(onKeepCloud)}
        style={styles.secondaryButton}
      >
        <Text style={styles.secondaryButtonText}>Keep cloud</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Apply my edit"
        disabled={submitting}
        onPress={() => void submit(onApplyMyEdit)}
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Apply my edit</Text>
      </Pressable>
    </ScrollView>
  )
}

type ConflictScreenProps = {
  repository?: ConflictResolutionRepository
  commands?: ConflictResolutionCommands
  createMutationId?: () => string
}

const ConflictRoute = ({ commands }: { commands: ConflictResolutionCommands }) => {
  const parameters = useLocalSearchParams<{ mutationId?: string | string[] }>()
  const mutationId = Array.isArray(parameters.mutationId)
    ? parameters.mutationId[0]
    : parameters.mutationId
  const [conflict, setConflict] = useState<ConflictRecord | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let current = true
    if (!mutationId) {
      setLoading(false)
      return () => { current = false }
    }
    setLoading(true)
    void commands.getConflict(mutationId).then((record) => {
      if (current) {
        setConflict(record)
        setLoading(false)
      }
    }).catch(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [commands, mutationId])

  if (loading) return <Text style={styles.message}>Loading conflict…</Text>
  if (!mutationId || !conflict) {
    return <Text accessibilityRole="alert" style={styles.message}>This conflict is no longer available.</Text>
  }
  return (
    <ConflictResolutionView
      conflict={conflict}
      onKeepCloud={() => commands.keepCloud(mutationId)}
      onApplyMyEdit={() => commands.applyMyEdit(mutationId)}
    />
  )
}

const ConnectedConflictRoute = () => (
  <ConflictRoute commands={useConflictResolutionCommands()} />
)

export default function ConflictScreen({
  repository,
  commands: suppliedCommands,
  createMutationId,
}: ConflictScreenProps) {
  const commands = useMemo(() => {
    if (suppliedCommands) return suppliedCommands
    if (repository) return createConflictResolutionCommands(repository, { createMutationId })
    return null
  }, [createMutationId, repository, suppliedCommands])
  return commands
    ? <ConflictRoute commands={commands} />
    : <ConnectedConflictRoute />
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 28, fontWeight: '700' },
  description: { color: '#475569', fontSize: 16 },
  fieldCard: { borderColor: '#CBD5E1', borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  fieldName: { fontSize: 16, fontWeight: '700' },
  comparison: { flexDirection: 'row', gap: 16 },
  valueColumn: { flex: 1, gap: 4 },
  valueLabel: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  error: { color: '#B91C1C' },
  primaryButton: { alignItems: 'center', backgroundColor: '#0F766E', borderRadius: 10, padding: 14 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', borderColor: '#0F766E', borderRadius: 10, borderWidth: 1, padding: 14 },
  secondaryButtonText: { color: '#0F766E', fontSize: 16, fontWeight: '700' },
  message: { padding: 24 },
})
