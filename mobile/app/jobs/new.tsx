import { useEffect, useState } from 'react'
import { ActivityIndicator } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { Client } from '../../src/domain/entities'
import { JobEditor } from '../../src/features/jobs/JobEditor'
import { colors } from '../../src/theme/tokens'

export default function NewJobScreen() {
  const { owner, repository } = useFieldCraftData()
  const [clients, setClients] = useState<Client[] | null>(null)
  useEffect(() => { void repository.list<Client>('client').then(setClients) }, [repository])
  if (!owner.ownerId || !clients) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  return <JobEditor clients={clients} ownerId={owner.ownerId} repository={repository} />
}
