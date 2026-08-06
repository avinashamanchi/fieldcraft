import * as Crypto from 'expo-crypto'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { ConfirmRecordDeleteSheet } from '../../components/ConfirmRecordDeleteSheet'
import { FormField } from '../../components/FormField'
import { PrimaryButton } from '../../components/PrimaryButton'
import { Screen } from '../../components/Screen'
import { VirtualizedEntityList } from '../../components/VirtualizedEntityList'
import type { SQLiteFieldCraftRepository } from '../../data/sqliteRepository'
import type { InventoryItem, Service } from '../../domain/entities'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../theme/tokens'
import { deleteRecordMutation } from '../recordMutation'
import {
  buildInventoryMutation,
  buildServiceMutation,
  type InventoryDraft,
  type ServiceDraft,
} from './catalogForm'

const EMPTY_SERVICE: ServiceDraft = { name: '', description: '', estimatedHoursThousandths: 0, unitPriceCents: 0, category: '' }
const EMPTY_INVENTORY: InventoryDraft = { name: '', quantityThousandths: 0, unit: 'each', minStockThousandths: 0, unitPriceCents: 0 }

type CatalogScreenProps = {
  entity: 'service' | 'inventory'
  ownerId: string
  repository: SQLiteFieldCraftRepository
}

export const CatalogScreen = ({ entity, ownerId, repository }: CatalogScreenProps) => {
  const [rows, setRows] = useState<(Service | InventoryItem)[]>([])
  const [current, setCurrent] = useState<Service | InventoryItem | undefined>()
  const [serviceDraft, setServiceDraft] = useState(EMPTY_SERVICE)
  const [inventoryDraft, setInventoryDraft] = useState(EMPTY_INVENTORY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const submitting = useRef(false)
  const load = useCallback(() => {
    void repository.list<Service | InventoryItem>(entity).then(setRows)
  }, [entity, repository])
  useEffect(() => {
    load()
    return repository.subscribeToLocalMutations(load)
  }, [load, repository])

  const choose = (item?: Service | InventoryItem) => {
    setCurrent(item)
    setError(null)
    if (entity === 'service') {
      const service = item as Service | undefined
      setServiceDraft(service ? {
        name: service.name, description: service.description ?? '',
        estimatedHoursThousandths: service.estimatedHoursThousandths ?? 0,
        unitPriceCents: service.unitPriceCents, category: service.category ?? '',
      } : EMPTY_SERVICE)
    } else {
      const inventory = item as InventoryItem | undefined
      setInventoryDraft(inventory ? {
        name: inventory.name, quantityThousandths: inventory.quantityThousandths ?? 0,
        unit: inventory.unit ?? 'each', minStockThousandths: inventory.minStockThousandths ?? 0,
        unitPriceCents: inventory.unitPriceCents,
      } : EMPTY_INVENTORY)
    }
  }
  const save = async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try {
      const common = {
        entityId: current?.id ?? Crypto.randomUUID(), mutationId: Crypto.randomUUID(),
        now: new Date().toISOString(), ownerId,
      }
      await repository.transactLocalMutation(entity === 'service'
        ? buildServiceMutation({ ...common, current: current as Service | undefined, draft: serviceDraft })
        : buildInventoryMutation({ ...common, current: current as InventoryItem | undefined, draft: inventoryDraft }))
      choose(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The record could not be saved locally.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!current) return
    setBusy(true)
    try {
      await repository.transactLocalMutation(deleteRecordMutation(entity, current, Crypto.randomUUID(), new Date().toISOString()))
      setConfirming(false)
      choose(undefined)
    } finally {
      setBusy(false)
    }
  }
  const title = entity === 'service' ? 'Services' : 'Inventory'

  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>{title}</Text>
      <Text style={styles.subheading}>{current ? `Edit ${entity}` : `Add ${entity}`}</Text>
      {entity === 'service' ? (
        <>
          <FormField label="Name" onChangeText={(name) => setServiceDraft((value) => ({ ...value, name }))} value={serviceDraft.name} />
          <FormField label="Description" multiline onChangeText={(description) => setServiceDraft((value) => ({ ...value, description }))} value={serviceDraft.description} />
          <FormField keyboardType="decimal-pad" label="Estimated hours" onChangeText={(value) => setServiceDraft((draft) => ({ ...draft, estimatedHoursThousandths: Math.round((Number(value) || 0) * 1000) }))} value={String(serviceDraft.estimatedHoursThousandths / 1000)} />
          <FormField keyboardType="decimal-pad" label="Unit price ($)" onChangeText={(value) => setServiceDraft((draft) => ({ ...draft, unitPriceCents: Math.round((Number(value) || 0) * 100) }))} value={(serviceDraft.unitPriceCents / 100).toFixed(2)} />
          <FormField label="Category" onChangeText={(category) => setServiceDraft((value) => ({ ...value, category }))} value={serviceDraft.category} />
        </>
      ) : (
        <>
          <FormField label="Name" onChangeText={(name) => setInventoryDraft((value) => ({ ...value, name }))} value={inventoryDraft.name} />
          <FormField keyboardType="decimal-pad" label="Quantity" onChangeText={(value) => setInventoryDraft((draft) => ({ ...draft, quantityThousandths: Math.round((Number(value) || 0) * 1000) }))} value={String(inventoryDraft.quantityThousandths / 1000)} />
          <FormField label="Unit" onChangeText={(unit) => setInventoryDraft((value) => ({ ...value, unit }))} value={inventoryDraft.unit} />
          <FormField keyboardType="decimal-pad" label="Low-stock threshold" onChangeText={(value) => setInventoryDraft((draft) => ({ ...draft, minStockThousandths: Math.round((Number(value) || 0) * 1000) }))} value={String(inventoryDraft.minStockThousandths / 1000)} />
          <FormField keyboardType="decimal-pad" label="Unit price ($)" onChangeText={(value) => setInventoryDraft((draft) => ({ ...draft, unitPriceCents: Math.round((Number(value) || 0) * 100) }))} value={(inventoryDraft.unitPriceCents / 100).toFixed(2)} />
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton disabled={busy} label={busy ? 'Saving…' : `Save ${entity}`} onPress={() => { void save() }} />
      {current ? (
        <View style={styles.editActions}>
          <Pressable accessibilityRole="button" onPress={() => setConfirming(true)} style={styles.textAction}><Text style={styles.deleteText}>Delete {entity}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => choose(undefined)} style={styles.textAction}><Text style={styles.cancelText}>Cancel editing</Text></Pressable>
        </View>
      ) : null}
      <Text style={styles.subheading}>Saved {title.toLocaleLowerCase()}</Text>
      <VirtualizedEntityList
        data={rows}
        emptyMessage={`No ${title.toLocaleLowerCase()} saved yet.`}
        renderItem={({ item }) => (
          <Pressable accessibilityLabel={`Edit ${item.name}`} accessibilityRole="button" onPress={() => choose(item)} style={styles.row}>
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowMeta}>{item.syncState === 'current' ? 'Cloud' : 'Pending'}</Text>
          </Pressable>
        )}
        scrollEnabled={false}
      />
      <ConfirmRecordDeleteSheet busy={busy} linkedCount={0} onCancel={() => setConfirming(false)} onConfirm={() => { void remove() }} recordLabel={entity} visible={confirming} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  cancelText: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 15 },
  deleteText: { color: colors.danger, fontFamily: typography.body, fontSize: 15, fontWeight: '800' },
  editActions: { gap: spacing.sm },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 15 },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  row: { borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingVertical: spacing.md },
  rowMeta: { color: colors.muted, fontFamily: typography.utility, fontSize: 12 },
  rowName: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
  screen: { gap: spacing.lg },
  subheading: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 20, fontWeight: '800', marginTop: spacing.md },
  textAction: { justifyContent: 'center', minHeight: MIN_TOUCH_TARGET },
})
