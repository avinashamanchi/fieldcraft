import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import type { MutationOutbox } from './outbox'
import type { OwnerSnapshot } from './ownerBoundary'
import { SQLiteFieldCraftRepository } from './sqliteRepository'

export type DataContextValue = {
  repository: SQLiteFieldCraftRepository
  outbox: MutationOutbox
  owner: OwnerSnapshot
  initializationError: Error | null
}

const DataContext = createContext<DataContextValue | null>(null)

export type DataProviderProps = PropsWithChildren<{
  ownerId: string | null
  repository?: SQLiteFieldCraftRepository
}>

export const DataProvider = ({ ownerId, repository: suppliedRepository, children }: DataProviderProps) => {
  const [repository] = useState(() => suppliedRepository ?? new SQLiteFieldCraftRepository())
  const [initializationError, setInitializationError] = useState<Error | null>(null)
  const mounted = useRef(true)
  const owner = useSyncExternalStore(
    repository.ownerBoundary.subscribe,
    repository.ownerBoundary.getSnapshot,
    repository.ownerBoundary.getSnapshot,
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (!mounted.current) void repository.close()
      })
    }
  }, [repository])

  useEffect(() => {
    let current = true
    setInitializationError(null)
    if (ownerId === null) {
      repository.deactivateOwner()
      return () => {
        current = false
      }
    }

    void repository.initialize(ownerId).catch((error: unknown) => {
      if (current) {
        setInitializationError(error instanceof Error ? error : new Error(String(error)))
      }
    })
    return () => {
      current = false
    }
  }, [ownerId, repository])

  return (
    <DataContext.Provider value={{ repository, outbox: repository.outbox, owner, initializationError }}>
      {children}
    </DataContext.Provider>
  )
}

export const useFieldCraftData = (): DataContextValue => {
  const context = useContext(DataContext)
  if (!context) throw new Error('useFieldCraftData must be used inside DataProvider')
  return context
}
