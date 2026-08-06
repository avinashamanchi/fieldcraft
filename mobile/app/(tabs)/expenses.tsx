import { EmptyState } from '../../src/components/EmptyState'
import { Screen } from '../../src/components/Screen'

export default function ExpensesScreen() {
  return <Screen scroll><EmptyState title="Expenses" message="Saved expenses will appear here." /></Screen>
}
