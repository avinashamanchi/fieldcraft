import { router } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { VirtualizedEntityList } from '../../src/components/VirtualizedEntityList'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { PageCursor } from '../../src/data/pagination'
import type { Estimate } from '../../src/domain/entities'
import { colors, MIN_TOUCH_TARGET, spacing, typography } from '../../src/theme/tokens'

const PAGE_SIZE = 50

export default function EstimatesScreen() {
  const { repository } = useFieldCraftData()
  const [estimates, setEstimates] = useState<Estimate[]>([])
  const cursorRef = useRef<PageCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeRequest = useRef(false)

  const load = useCallback(async (append: boolean) => {
    if (activeRequest.current) return
    activeRequest.current = true
    setLoading(true)
    setError(null)
    try {
      const page = await repository.listPage<Estimate>('estimate', {
        limit: PAGE_SIZE,
        after: append ? cursorRef.current : null,
      })
      setEstimates((current) => append ? [...current, ...page.items] : page.items)
      cursorRef.current = page.next
      setHasMore(page.next !== null)
    } catch {
      setError('Estimates could not be loaded from this device. Try again.')
    } finally {
      activeRequest.current = false
      setLoading(false)
    }
  }, [repository])

  useEffect(() => {
    void load(false)
    return repository.subscribeToLocalMutations(() => { void load(false) })
  }, [load, repository]) // Intentionally reset from page one whenever local ordering changes.

  return (
    <Screen contentContainerStyle={styles.screen}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="header" style={styles.heading}>Estimates</Text>
        <PrimaryButton label="New" onPress={() => router.push('/estimates/new' as never)} />
      </View>
      <Text style={styles.copy}>Draft, issue, record the customer’s decision, and convert accepted work into a job.</Text>
      {error ? (
        <View style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <PrimaryButton label="Try again" onPress={() => { void load(false) }} />
        </View>
      ) : null}
      <VirtualizedEntityList
        data={estimates}
        emptyMessage={loading ? 'Loading estimates…' : 'No estimates yet. Create the first one on this device.'}
        hasMore={hasMore}
        loadingMore={loading && estimates.length > 0}
        onLoadMore={() => { void load(true) }}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`${item.title}, ${item.status}, ${(item.totalCents / 100).toFixed(2)} dollars`}
            accessibilityRole="button"
            onPress={() => router.push(`/estimates/${item.id}` as never)}
            style={styles.row}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.meta}>{item.number ?? 'Draft'} · {item.status} · {item.syncState === 'current' ? 'Cloud' : 'Pending'}</Text>
            </View>
            <Text style={styles.amount}>${(item.totalCents / 100).toFixed(2)}</Text>
          </Pressable>
        )}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  amount: { color: colors.warmWhite, fontFamily: typography.utility, fontSize: 16, fontWeight: '800' },
  copy: { color: colors.muted, fontFamily: typography.body, fontSize: 15, lineHeight: 22 },
  error: { color: colors.danger, fontFamily: typography.body, fontSize: 14 },
  errorCard: { gap: spacing.md },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 34, fontWeight: '800' },
  headingRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.muted, fontFamily: typography.body, fontSize: 13 },
  row: { alignItems: 'center', borderBottomColor: '#444', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between', minHeight: MIN_TOUCH_TARGET, paddingVertical: spacing.md },
  rowCopy: { flex: 1, gap: spacing.xs },
  screen: { flex: 1, gap: spacing.md },
  title: { color: colors.warmWhite, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
})
