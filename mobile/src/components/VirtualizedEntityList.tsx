import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type FlatListProps } from 'react-native'

import { colors, spacing, typography } from '../theme/tokens'

type Identified = { id: string }
type VirtualizedEntityListProps<T extends Identified> = Omit<FlatListProps<T>, 'keyExtractor'> & {
  emptyMessage: string
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

export const VirtualizedEntityList = <T extends Identified>({
  emptyMessage,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  ...props
}: VirtualizedEntityListProps<T>) => (
  <FlatList
    contentContainerStyle={[styles.content, (props.data?.length ?? 0) === 0 && styles.emptyContent]}
    initialNumToRender={20}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    keyExtractor={(item) => item.id}
    ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
    ListFooterComponent={hasMore || loadingMore ? (
      <View style={styles.footer}>
        {loadingMore ? <ActivityIndicator color={colors.orange} /> : (
          <Pressable accessibilityRole="button" onPress={onLoadMore} style={styles.loadMore}>
            <Text style={styles.loadMoreText}>Load 50 more</Text>
          </Pressable>
        )}
      </View>
    ) : null}
    maxToRenderPerBatch={24}
    removeClippedSubviews
    onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
    onEndReachedThreshold={0.25}
    testID="virtualized-entity-list"
    windowSize={7}
    {...props}
  />
)

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  empty: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  footer: { alignItems: 'center', minHeight: 64, paddingVertical: spacing.md },
  loadMore: { alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.lg },
  loadMoreText: { color: colors.orange, fontFamily: typography.body, fontSize: 16, fontWeight: '700' },
})
