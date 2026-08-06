import { EmptyState } from '../../src/components/EmptyState'
import { Screen } from '../../src/components/Screen'

export default function ClientsScreen() {
  return <Screen scroll><EmptyState title="Clients" message="Saved clients will appear here." /></Screen>
}
