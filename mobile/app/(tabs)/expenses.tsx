import { router } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { EmptyState } from '../../src/components/EmptyState'
import { PrimaryButton } from '../../src/components/PrimaryButton'
import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Expense } from '../../src/domain/entities'
import { colors, radius, spacing, typography } from '../../src/theme/tokens'

export default function ExpensesScreen() {
  const { repository } = useFieldCraftData()
  const [expenses, setExpenses] = useState<Expense[] | null>(null)
  const load = useCallback(() => { void repository.list<Expense>('expense').then(setExpenses).catch(() => setExpenses([])) }, [repository])
  useEffect(() => { load(); return repository.subscribeToLocalMutations(load) }, [load, repository])
  if (expenses === null) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return (
    <Screen contentContainerStyle={styles.screen} scroll>
      <Text accessibilityRole="header" style={styles.heading}>Expenses</Text>
      <PrimaryButton label="Add expense" onPress={() => router.push('/expenses/new' as never)} />
      {expenses.length === 0 ? <EmptyState title="No expenses yet" message="Add one manually or scan a receipt on a development build." /> : expenses.map((expense) => (
        <View key={expense.id} style={styles.card}>
          <View style={styles.row}><Text style={styles.vendor}>{expense.vendor}</Text><Text style={styles.amount}>${(expense.amountCents / 100).toFixed(2)}</Text></View>
          <Text style={styles.meta}>{expense.expenseDate} · {expense.category} · {expense.syncState}</Text>
        </View>
      ))}
    </Screen>
  )
}

const styles = StyleSheet.create({
  amount: { color: colors.orange, fontFamily: typography.utility, fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.panel, borderRadius: radius.md, gap: spacing.sm, padding: spacing.lg },
  heading: { color: colors.warmWhite, fontFamily: typography.display, fontSize: 36, fontWeight: '800' },
  meta: { color: colors.muted, fontFamily: typography.body, fontSize: 13 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  screen: { gap: spacing.lg },
  vendor: { color: colors.warmWhite, flex: 1, fontFamily: typography.body, fontSize: 17, fontWeight: '700' },
})
