import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { VirtualizedEntityList } from '../../src/components/VirtualizedEntityList'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client } from '../../src/domain/entities'
import { filterClients } from '../../src/features/clients/clientForm'
import { colors, MIN_TOUCH_TARGET, radius, spacing, typography } from '../../src/theme/tokens'

export default function ClientsScreen() {
  const { repository } = useFieldCraftData()
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const load = useCallback(() => { void repository.list<Client>('client').then(setClients) }, [repository])
  useEffect(() => {
    load()
    return repository.subscribeToLocalMutations(load)
  }, [load, repository])
  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>Clients</Text>
        <PrimaryButton label="Add" onPress={() => router.push('/clients/new')} />
      </View>
      <TextInput accessibilityLabel="Search clients" onChangeText={setQuery} placeholder="Search name, phone, or email" placeholderTextColor={colors.muted} style={styles.search} value={query} />
      <VirtualizedEntityList
        data={filterClients(clients, query)}
        emptyMessage={clients.length === 0 ? 'No clients yet. Add the first client to this device.' : 'No clients match this literal search.'}
        renderItem={({ item }) => (
          <Pressable accessibilityLabel={`${item.name}, ${item.syncState === 'current' ? 'Cloud' : 'Pending'}`} accessibilityRole="button" onPress={() => router.push(`/clients/${item.id}`)} style={styles.row}>
            <View><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>{item.phone || item.email || 'No contact details'} · {item.syncState === 'current' ? 'Cloud' : 'Pending'}</Text></View>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.muted, fontFamily: typography.body, fontSize: 13, marginTop: spacing.xs },
  name: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
  row: { borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center', minHeight: MIN_TOUCH_TARGET, paddingVertical: spacing.md },
  screen: { flex: 1, gap: spacing.md },
  search: { backgroundColor: colors.panel, borderRadius: radius.md, color: colors.warmWhite, fontFamily: typography.body, fontSize: 16, minHeight: MIN_TOUCH_TARGET, paddingHorizontal: spacing.md },
})
