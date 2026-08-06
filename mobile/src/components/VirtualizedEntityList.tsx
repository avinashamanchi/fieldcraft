import { FlatList, StyleSheet, Text, type FlatListProps } from 'react-native'

import { colors, spacing, typography } from '../theme/tokens'

type Identified = { id: string }
type VirtualizedEntityListProps<T extends Identified> = Omit<FlatListProps<T>, 'keyExtractor'> & {
  emptyMessage: string
}

export const VirtualizedEntityList = <T extends Identified>({
  emptyMessage,
  ...props
}: VirtualizedEntityListProps<T>) => (
  <FlatList
    contentContainerStyle={[styles.content, (props.data?.length ?? 0) === 0 && styles.emptyContent]}
    initialNumToRender={20}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    keyExtractor={(item) => item.id}
    ListEmptyComponent={<Text style={styles.empty}>{emptyMessage}</Text>}
    maxToRenderPerBatch={24}
    removeClippedSubviews
    testID="virtualized-entity-list"
    windowSize={7}
    {...props}
  />
)

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl },
  empty: { color: colors.muted, fontFamily: typography.body, fontSize: 16, lineHeight: 24 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
})
