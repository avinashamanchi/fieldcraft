import { EmptyState } from '../../src/components/EmptyState'
import { Screen } from '../../src/components/Screen'

export default function SettingsScreen() {
  return <Screen scroll><EmptyState title="Settings" message="Account and privacy controls will appear here." /></Screen>
}
