import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { AppState } from 'react-native'
import * as Network from 'expo-network'
import { router } from 'expo-router'

import { useAuth } from '../auth/AuthProvider'
import { getAuthService } from '../auth/authService'
import { useFieldCraftData } from './DataProvider'
import { createSupabaseGateway } from './supabaseGateway'
import {
  createConflictResolutionCommands,
  RemoteGatewayError,
  SyncCoordinator,
  type ConflictResolutionCommands,
  type ConflictResolutionRepository,
  type SyncLifecycle,
  type SyncStatus,
} from './syncCoordinator'

type SyncContextValue = {
  coordinator: SyncCoordinator
  conflictCommands: ConflictResolutionCommands | null
}

const SyncContext = createContext<SyncContextValue | null>(null)

type ManagedSyncProviderProps = PropsWithChildren<{
  coordinator: SyncCoordinator
  lifecycle: SyncLifecycle
  conflictRepository?: ConflictResolutionRepository
}>

const ManagedSyncProvider = ({
  coordinator,
  lifecycle,
  conflictRepository,
  children,
}: ManagedSyncProviderProps) => {
  const conflictCommands = useMemo(
    () => conflictRepository ? createConflictResolutionCommands(conflictRepository) : null,
    [conflictRepository],
  )

  useEffect(() => {
    void coordinator.setLifecycle(lifecycle)
  }, [coordinator, lifecycle])

  useEffect(() => () => coordinator.dispose(), [coordinator])

  return (
    <SyncContext.Provider value={{ coordinator, conflictCommands }}>
      {children}
    </SyncContext.Provider>
  )
}

const ConnectedSyncProvider = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  const { repository, owner } = useFieldCraftData()
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [online, setOnline] = useState(false)
  const coordinator = useMemo(() => new SyncCoordinator({
    repository,
    gateway: createSupabaseGateway(),
    async refreshAuthentication(ownerId, signal) {
      const session = await getAuthService().getSession()
      if (
        signal.aborted ||
        !session ||
        session.user.id !== ownerId ||
        !session.user.emailConfirmedAt
      ) {
        throw new RemoteGatewayError('reauthentication')
      }
    },
    onReauthenticationRequired: () => router.replace('/(auth)/login'),
  }), [repository])

  useEffect(() => {
    let current = true
    const update = (state: { isConnected?: boolean; isInternetReachable?: boolean | null }) => {
      if (current) setOnline(state.isConnected === true && state.isInternetReachable !== false)
    }
    void Network.getNetworkStateAsync().then(update).catch(() => {
      if (current) setOnline(false)
    })
    const networkSubscription = Network.addNetworkStateListener(update)
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (current) setForeground(state === 'active')
    })
    return () => {
      current = false
      networkSubscription.remove()
      appSubscription.remove()
    }
  }, [])

  const signedInOwner = auth.status === 'signedIn' && auth.hydrated
    ? auth.userId
    : null
  const ownerId = signedInOwner !== null && owner.ownerId === signedInOwner
    ? signedInOwner
    : null
  const lifecycle = useMemo<SyncLifecycle>(() => ({
    ownerId,
    authenticated: ownerId !== null,
    foreground,
    online,
  }), [foreground, online, ownerId])

  return (
    <ManagedSyncProvider
      coordinator={coordinator}
      conflictRepository={repository}
      lifecycle={lifecycle}
    >
      {children}
    </ManagedSyncProvider>
  )
}

export type SyncProviderProps = PropsWithChildren<{
  coordinator?: SyncCoordinator
  lifecycle?: SyncLifecycle
  conflictRepository?: ConflictResolutionRepository
}>

export const SyncProvider = ({
  coordinator,
  lifecycle,
  conflictRepository,
  children,
}: SyncProviderProps) => {
  if (coordinator && lifecycle) {
    return (
      <ManagedSyncProvider
        coordinator={coordinator}
        lifecycle={lifecycle}
        conflictRepository={conflictRepository}
      >
        {children}
      </ManagedSyncProvider>
    )
  }
  if (coordinator || lifecycle) {
    throw new Error('Injected synchronization requires both coordinator and lifecycle')
  }
  return <ConnectedSyncProvider>{children}</ConnectedSyncProvider>
}

const useSyncContext = (): SyncContextValue => {
  const context = useContext(SyncContext)
  if (!context) throw new Error('Synchronization hooks require SyncProvider')
  return context
}

export const useSyncStatus = (): SyncStatus => {
  const { coordinator } = useSyncContext()
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getStatus,
    coordinator.getStatus,
  )
}

export const useConflictResolutionCommands = (): ConflictResolutionCommands => {
  const { conflictCommands } = useSyncContext()
  if (!conflictCommands) throw new Error('Conflict commands require a repository-backed SyncProvider')
  return conflictCommands
}
