import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text } from 'react-native'

import { Screen } from '../../src/components/Screen'
import { useFieldCraftData } from '../../src/data/DataProvider'
import type { PageCursor } from '../../src/data/pagination'
import type { Client } from '../../src/domain/entities'
import { EstimateEditor } from '../../src/features/estimates/EstimateEditor'
import { colors } from '../../src/theme/tokens'

export default function NewEstimateScreen() {
  const { owner, repository } = useFieldCraftData()
  const [clients, setClients] = useState<Client[]>([])
  const [cursor, setCursor] = useState<PageCursor | null>(null)
  const cursorRef = useRef<PageCursor | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loading = useRef(false)
  const load = useCallback(async (append: boolean) => {
    if (loading.current) return
    loading.current = true
    try {
      const page = await repository.listPage<Client>('client', { limit: 50, after: append ? cursorRef.current : null })
      setClients((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.next)
      cursorRef.current = page.next
      setError(null)
    } catch {
      setError('Clients could not be loaded from this device.')
    } finally {
      loading.current = false
      setReady(true)
    }
  }, [repository])
  useEffect(() => { void load(false) }, [load])
  if (!owner.ownerId || !ready) return <Screen><ActivityIndicator color={colors.orange} /></Screen>
  if (error) return <Screen><Text accessibilityRole="alert">{error}</Text></Screen>
  return <EstimateEditor clients={clients} hasMoreClients={cursor !== null} onLoadMoreClients={() => { void load(true) }} ownerId={owner.ownerId} repository={repository} />
}
