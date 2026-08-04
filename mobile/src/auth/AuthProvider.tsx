import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState } from 'react-native'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'

import { createAuthDeepLinkProcessor, type SafeAuthRoute } from './deepLinks'
import { getAuthService, type AuthService, type AuthSession } from './authService'

export type AuthState =
  | { status: 'initializing' }
  | { status: 'signedOut' }
  | { status: 'verificationRequired'; email: string }
  | { status: 'signedIn'; userId: string; email: string; hydrated: boolean }
  | { status: 'storageError'; message: string }

export type AuthDataLifecycle = {
  initialize(ownerId: string): Promise<void>
  deactivateOwner(): void
  clearOwner(ownerId: string): Promise<void>
  ownerBoundary?: { getSnapshot(): { ownerId: string | null } }
}

type RemovableSubscription = { remove(): void }

export type AppStateLifecycle = {
  currentState: string | null
  addEventListener(event: 'change', listener: (state: string) => void): RemovableSubscription
}

export type LinkingLifecycle = {
  getInitialURL(): Promise<string | null>
  addEventListener(event: 'url', listener: (event: { url: string }) => void): RemovableSubscription
}

type AuthProviderProps = PropsWithChildren<{
  dataLifecycle: AuthDataLifecycle
  service?: AuthService
  appState?: AppStateLifecycle
  linking?: LinkingLifecycle
  replaceRoute?: (route: SafeAuthRoute) => void
}>

type LifecycleBlock = 'refresh' | 'subscription'
type OwnerClear = {
  status: 'pending' | 'failed'
  promise: Promise<void>
}

const ownerClearRegistries = new WeakMap<object, Map<string, OwnerClear>>()

const getOwnerClearRegistry = (dataLifecycle: AuthDataLifecycle): Map<string, OwnerClear> => {
  const existing = ownerClearRegistries.get(dataLifecycle)
  if (existing) return existing
  const created = new Map<string, OwnerClear>()
  ownerClearRegistries.set(dataLifecycle, created)
  return created
}

const AuthContext = createContext<AuthState | null>(null)

const STORAGE_MESSAGE = 'Secure authentication storage is unavailable.'
const LOCAL_DATA_MESSAGE = 'Local data could not be prepared securely.'
const SESSION_LIFECYCLE_MESSAGE = 'Authentication session lifecycle is unavailable.'
const defaultReplaceRoute = (route: SafeAuthRoute) => router.replace(route)

export const AuthProvider = ({
  dataLifecycle,
  service: suppliedService,
  appState = AppState,
  linking = Linking,
  replaceRoute = defaultReplaceRoute,
  children,
}: AuthProviderProps) => {
  const [state, setState] = useState<AuthState>({ status: 'initializing' })
  const service = useMemo(() => suppliedService ?? getAuthService(), [suppliedService])
  const lifecycleBlocks = useRef(new Set<LifecycleBlock>())
  const restoreSession = useRef<() => void>(() => {})
  const invalidateSession = useRef<() => void>(() => dataLifecycle.deactivateOwner())

  useEffect(() => {
    let disposed = false
    let generation = 0
    let targetOwnerId: string | null = null
    let activeOwnerId = dataLifecycle.ownerBoundary?.getSnapshot().ownerId ?? null
    let callbackVersion = 0
    const ownerClears = getOwnerClearRegistry(dataLifecycle)

    dataLifecycle.deactivateOwner()
    invalidateSession.current = () => {
      generation += 1
      targetOwnerId = null
      activeOwnerId = null
      dataLifecycle.deactivateOwner()
    }

    const showStorageError = (message: string) => {
      if (!disposed) setState({ status: 'storageError', message })
    }

    const startOwnerClear = (ownerId: string, retryFailed: boolean): Promise<void> => {
      const existing = ownerClears.get(ownerId)
      if (existing && (existing.status === 'pending' || !retryFailed)) return existing.promise

      const record: OwnerClear = { status: 'pending', promise: Promise.resolve() }
      const clearing = Promise.resolve()
        .then(() => dataLifecycle.clearOwner(ownerId))
        .then(() => {
          if (ownerClears.get(ownerId) === record) ownerClears.delete(ownerId)
        })
        .catch(() => {
          record.status = 'failed'
          throw new Error(LOCAL_DATA_MESSAGE)
        })
      record.promise = clearing
      ownerClears.set(ownerId, record)
      return clearing
    }

    const failOwnerLifecycle = (currentGeneration: number) => {
      if (currentGeneration !== generation) return
      targetOwnerId = null
      activeOwnerId = null
      dataLifecycle.deactivateOwner()
      showStorageError(LOCAL_DATA_MESSAGE)
    }

    const clearPreviousOwner = async (ownerId: string, currentGeneration: number) => {
      try {
        await startOwnerClear(ownerId, true)
      } catch {
        failOwnerLifecycle(currentGeneration)
        throw new Error(LOCAL_DATA_MESSAGE)
      }
    }

    const awaitOwnerClear = async (ownerId: string, currentGeneration: number): Promise<boolean> => {
      const existing = ownerClears.get(ownerId)
      if (!existing) return true
      try {
        await startOwnerClear(ownerId, existing.status === 'failed')
        return currentGeneration === generation
      } catch {
        failOwnerLifecycle(currentGeneration)
        return false
      }
    }

    const reconcile = async (session: AuthSession | null) => {
      if (lifecycleBlocks.current.size > 0) {
        dataLifecycle.deactivateOwner()
        return
      }
      const currentGeneration = ++generation
      const user = session?.user

      if (!user || !user.emailConfirmedAt) {
        const previousOwnerId = targetOwnerId ?? activeOwnerId
        targetOwnerId = null
        activeOwnerId = null
        if (previousOwnerId) dataLifecycle.deactivateOwner()
        if (!disposed) {
          setState(
            user
              ? { status: 'verificationRequired', email: user.email }
              : { status: 'signedOut' },
          )
        }
        if (previousOwnerId) {
          try {
            await clearPreviousOwner(previousOwnerId, currentGeneration)
          } catch {
            // clearPreviousOwner already left the provider fail-closed.
          }
        }
        return
      }

      if (targetOwnerId === user.id) return
      const previousOwnerId = targetOwnerId ?? activeOwnerId
      targetOwnerId = user.id
      activeOwnerId = null
      if (previousOwnerId && previousOwnerId !== user.id) dataLifecycle.deactivateOwner()
      if (!disposed) {
        setState({ status: 'signedIn', userId: user.id, email: user.email, hydrated: false })
      }

      if (previousOwnerId && previousOwnerId !== user.id) {
        try {
          await clearPreviousOwner(previousOwnerId, currentGeneration)
        } catch {
          return
        }
      }
      if (!(await awaitOwnerClear(user.id, currentGeneration))) return
      if (
        disposed ||
        lifecycleBlocks.current.size > 0 ||
        currentGeneration !== generation ||
        targetOwnerId !== user.id
      ) {
        return
      }

      try {
        await dataLifecycle.initialize(user.id)
      } catch {
        if (!disposed && currentGeneration === generation) {
          targetOwnerId = null
          dataLifecycle.deactivateOwner()
          showStorageError(LOCAL_DATA_MESSAGE)
        }
        return
      }
      if (
        disposed ||
        lifecycleBlocks.current.size > 0 ||
        currentGeneration !== generation ||
        targetOwnerId !== user.id
      ) {
        return
      }
      activeOwnerId = user.id
      setState({ status: 'signedIn', userId: user.id, email: user.email, hydrated: true })
    }

    let unsubscribe = () => {}
    try {
      unsubscribe = service.subscribe((session) => {
        callbackVersion += 1
        void reconcile(session)
      })
      lifecycleBlocks.current.delete('subscription')
    } catch {
      lifecycleBlocks.current.add('subscription')
      dataLifecycle.deactivateOwner()
      showStorageError(STORAGE_MESSAGE)
      restoreSession.current = () => {}
      return () => {
        disposed = true
        generation += 1
        dataLifecycle.deactivateOwner()
      }
    }

    const restore = () => {
      const versionBeforeSession = callbackVersion
      void service
        .getSession()
        .then((session) => {
          if (
            !disposed &&
            lifecycleBlocks.current.size === 0 &&
            callbackVersion === versionBeforeSession
          ) {
            return reconcile(session)
          }
        })
        .catch(() => {
          if (!disposed && callbackVersion === versionBeforeSession) {
            generation += 1
            targetOwnerId = null
            activeOwnerId = null
            dataLifecycle.deactivateOwner()
            showStorageError(STORAGE_MESSAGE)
          }
        })
    }
    restoreSession.current = restore
    restore()

    return () => {
      disposed = true
      generation += 1
      restoreSession.current = () => {}
      invalidateSession.current = () => dataLifecycle.deactivateOwner()
      unsubscribe()
      dataLifecycle.deactivateOwner()
    }
  }, [dataLifecycle, service])

  useEffect(() => {
    let desiredRefresh = false
    let appliedRefresh: boolean | null = null
    let draining = false
    let mounted = true

    const failRefreshLifecycle = () => {
      lifecycleBlocks.current.add('refresh')
      invalidateSession.current()
      if (mounted) setState({ status: 'storageError', message: SESSION_LIFECYCLE_MESSAGE })
    }

    const drainTransitions = async () => {
      if (draining) return
      draining = true
      let transitionFailed = false
      let failedTarget: boolean | null = null
      try {
        while (appliedRefresh !== desiredRefresh) {
          const nextRefresh = desiredRefresh
          try {
            if (nextRefresh) await service.startAutoRefresh()
            else await service.stopAutoRefresh()
          } catch {
            transitionFailed = true
            failedTarget = nextRefresh
            appliedRefresh = null
            failRefreshLifecycle()
            break
          }
          appliedRefresh = nextRefresh
          if (nextRefresh && lifecycleBlocks.current.delete('refresh')) {
            if (lifecycleBlocks.current.size === 0) restoreSession.current()
          }
        }
      } finally {
        draining = false
        if (
          appliedRefresh !== desiredRefresh &&
          (!transitionFailed || failedTarget !== desiredRefresh)
        ) {
          void drainTransitions()
        }
      }
    }

    const updateRefresh = (nextState: string) => {
      const shouldRefresh = nextState === 'active'
      if (desiredRefresh === shouldRefresh && appliedRefresh === shouldRefresh) return
      desiredRefresh = shouldRefresh
      void drainTransitions()
    }

    updateRefresh(appState.currentState ?? 'background')
    const subscription = appState.addEventListener('change', updateRefresh)
    return () => {
      mounted = false
      subscription.remove()
      desiredRefresh = false
      void drainTransitions()
    }
  }, [appState, dataLifecycle, service])

  useEffect(() => {
    const processor = createAuthDeepLinkProcessor({
      exchangeCode: service.exchangeCode.bind(service),
      verifySignup: service.verifySignup.bind(service),
      recoverPassword: service.recoverPassword.bind(service),
      replace: replaceRoute,
    })
    let disposed = false
    const handle = (url: string) => {
      if (!disposed) void processor.handle(url).catch(() => {})
    }
    void linking.getInitialURL().then((url) => {
      if (url) handle(url)
    }).catch(() => {})
    const subscription = linking.addEventListener('url', ({ url }) => handle(url))
    return () => {
      disposed = true
      processor.cancel()
      subscription.remove()
    }
  }, [linking, replaceRoute, service])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthState => {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside AuthProvider')
  return state
}
