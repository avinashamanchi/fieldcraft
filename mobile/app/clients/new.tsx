import { ActivityIndicator } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { ClientEditor } from '../../src/features/clients/ClientEditor'
import { colors } from '../../src/theme/tokens'

export default function NewClientScreen() {
  const { owner, repository } = useFieldCraftData()
  if (!owner.ownerId) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return <ClientEditor ownerId={owner.ownerId} repository={repository} />
}
