import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
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

const AuthContext = createContext<AuthState | null>(null)

const STORAGE_MESSAGE = 'Secure authentication storage is unavailable.'
const LOCAL_DATA_MESSAGE = 'Local data could not be prepared securely.'
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

  useEffect(() => {
    let disposed = false
    let generation = 0
    let targetOwnerId: string | null = null
    let activeOwnerId = dataLifecycle.ownerBoundary?.getSnapshot().ownerId ?? null
    let callbackVersion = 0

    dataLifecycle.deactivateOwner()

    const showStorageError = (message: string) => {
      if (!disposed) setState({ status: 'storageError', message })
    }

    const clearPreviousOwner = async (ownerId: string, currentGeneration: number) => {
      try {
        await dataLifecycle.clearOwner(ownerId)
      } catch {
        if (!disposed && currentGeneration === generation) showStorageError(LOCAL_DATA_MESSAGE)
        throw new Error(LOCAL_DATA_MESSAGE)
      }
    }

    const reconcile = async (session: AuthSession | null) => {
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
            // clearPreviousOwner already put the provider in a fail-closed state.
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
      if (disposed || currentGeneration !== generation || targetOwnerId !== user.id) return

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
      if (disposed || currentGeneration !== generation || targetOwnerId !== user.id) return
      activeOwnerId = user.id
      setState({ status: 'signedIn', userId: user.id, email: user.email, hydrated: true })
    }

    let unsubscribe = () => {}
    try {
      unsubscribe = service.subscribe((session) => {
        callbackVersion += 1
        void reconcile(session)
      })
    } catch {
      showStorageError(STORAGE_MESSAGE)
    }

    const versionBeforeInitialSession = callbackVersion
    void service
      .getSession()
      .then((session) => {
        if (!disposed && callbackVersion === versionBeforeInitialSession) return reconcile(session)
      })
      .catch(() => {
        if (!disposed && callbackVersion === versionBeforeInitialSession) {
          generation += 1
          targetOwnerId = null
          activeOwnerId = null
          dataLifecycle.deactivateOwner()
          showStorageError(STORAGE_MESSAGE)
        }
      })

    return () => {
      disposed = true
      generation += 1
      unsubscribe()
      dataLifecycle.deactivateOwner()
    }
  }, [dataLifecycle, service])

  useEffect(() => {
    let desiredRefresh = false
    let appliedRefresh: boolean | null = null
    let draining = false

    const drainTransitions = async () => {
      if (draining) return
      draining = true
      try {
        while (appliedRefresh !== desiredRefresh) {
          const nextRefresh = desiredRefresh
          try {
            if (nextRefresh) await service.startAutoRefresh()
            else await service.stopAutoRefresh()
          } catch {
            // Auth state callbacks surface session failures without provider details.
          }
          appliedRefresh = nextRefresh
        }
      } finally {
        draining = false
        if (appliedRefresh !== desiredRefresh) void drainTransitions()
      }
    }

    const updateRefresh = (nextState: string) => {
      const shouldRefresh = nextState === 'active'
      if (desiredRefresh === shouldRefresh && appliedRefresh !== null) return
      desiredRefresh = shouldRefresh
      void drainTransitions()
    }

    updateRefresh(appState.currentState ?? 'background')
    const subscription = appState.addEventListener('change', updateRefresh)
    return () => {
      subscription.remove()
      desiredRefresh = false
      void drainTransitions()
    }
  }, [appState, service])

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
