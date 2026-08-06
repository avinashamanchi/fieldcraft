import { EmptyState } from '../../src/components/EmptyState'
import { Screen } from '../../src/components/Screen'

export default function JobsScreen() {
  return <Screen scroll><EmptyState title="Jobs" message="Saved jobs will appear here." /></Screen>
}
