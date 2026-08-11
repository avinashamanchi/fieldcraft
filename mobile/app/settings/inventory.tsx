import { ActivityIndicator } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import { CatalogScreen } from '../../src/features/catalog/CatalogScreen'
import { colors } from '../../src/theme/tokens'

export default function InventoryScreen() {
  const { owner, repository } = useFieldCraftData()
  if (!owner.ownerId) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return <CatalogScreen entity="inventory" ownerId={owner.ownerId} repository={repository} />
}
