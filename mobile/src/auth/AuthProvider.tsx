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
import {
  getAuthService,
  type AuthEvent,
  type AuthService,
  type AuthSession,
} from './authService'
import { getRecentAal2Guard, type RecentAal2Guard } from './requireAal2'

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
  hasCompletedInitialPull?(ownerId: string): Promise<boolean>
  waitForInitialPull?(ownerId: string): Promise<void>
  ownerBoundary?: {
    getSnapshot(): { ownerId: string | null }
    subscribe?(listener: () => void): () => void
  }
}

export type AuthenticatedOwnerLease = Readonly<{
  ownerId: string
  sessionGeneration: number
  repositoryRevision: number
}>

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
  aal2Guard?: RecentAal2Guard
}>

type LifecycleBlock = 'refresh' | 'subscription'
type OwnerClear = {
  status: 'pending' | 'failed'
  promise: Promise<void>
}
type RefreshLifecycleHandlers = {
  onBlocked(): void
  onFailure(): void
  onForegroundApplied(): void
}
type RefreshLifecycleLease = {
  update(shouldRefresh: boolean): void
  release(): void
}

const ownerClearRegistries = new WeakMap<object, Map<string, OwnerClear>>()
const refreshLifecycleControllers = new WeakMap<object, RefreshLifecycleController>()
const sessionGenerationCounters = new WeakMap<object, number>()
const repositoryRevisionCounters = new WeakMap<object, number>()
const REFRESH_RETRY_BASE_DELAY_MS = 25
const REFRESH_RETRY_MAX_DELAY_MS = 1_000
const MAX_UNMOUNT_REFRESH_FAILURES = 3

class RefreshLifecycleController {
  private desiredRefresh = false
  private desiredVersion = 0
  private appliedRefresh: boolean | null = null
  private stopRequired = false
  private draining = false
  private mounted = false
  private consecutiveFailures = 0
  private unmountFailures = 0
  private activeLease: symbol | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private handlers: RefreshLifecycleHandlers = {
    onBlocked: () => {},
    onFailure: () => {},
    onForegroundApplied: () => {},
  }

  constructor(private readonly service: AuthService) {}

  attach(
    shouldRefresh: boolean,
    handlers: RefreshLifecycleHandlers,
  ): RefreshLifecycleLease {
    const lease = Symbol('refresh-lifecycle')
    this.activeLease = lease
    this.mounted = true
    this.handlers = handlers
    this.desiredRefresh = shouldRefresh
    this.desiredVersion += 1
    this.consecutiveFailures = 0
    this.unmountFailures = 0
    this.clearRetryTimer()
    if (this.draining || this.needsTransition()) this.handlers.onBlocked()
    if (this.stopRequired) this.handlers.onFailure()
    void this.drain()

    return {
      update: (nextRefresh) => {
        if (this.activeLease !== lease) return
        const changed = this.desiredRefresh !== nextRefresh
        this.desiredRefresh = nextRefresh
        if (changed) {
          this.desiredVersion += 1
          this.consecutiveFailures = 0
          this.unmountFailures = 0
          this.clearRetryTimer()
        }
        if (changed || this.needsTransition()) void this.drain()
      },
      release: () => {
        if (this.activeLease !== lease) return
        this.activeLease = null
        this.mounted = false
        this.handlers = {
          onBlocked: () => {},
          onFailure: () => {},
          onForegroundApplied: () => {},
        }
        this.desiredRefresh = false
        this.desiredVersion += 1
        this.consecutiveFailures = 0
        this.unmountFailures = 0
        this.clearRetryTimer()
        void this.drain()
      },
    }
  }

  private needsTransition(): boolean {
    return this.stopRequired || this.appliedRefresh !== this.desiredRefresh
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return
    clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null || !this.needsTransition()) return
    if (!this.mounted && this.unmountFailures >= MAX_UNMOUNT_REFRESH_FAILURES) return
    const scheduledVersion = this.desiredVersion
    const delay = Math.min(
      REFRESH_RETRY_MAX_DELAY_MS,
      REFRESH_RETRY_BASE_DELAY_MS * 2 ** Math.min(Math.max(this.consecutiveFailures - 1, 0), 5),
    )
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (scheduledVersion !== this.desiredVersion || this.needsTransition()) {
        void this.drain()
      }
    }, delay)
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.needsTransition()) {
        const targetRefresh = this.stopRequired ? false : this.desiredRefresh
        const attemptedVersion = this.desiredVersion
        try {
          if (targetRefresh) await this.service.startAutoRefresh()
          else await this.service.stopAutoRefresh()
        } catch {
          this.appliedRefresh = null
          if (!targetRefresh) this.stopRequired = true
          this.consecutiveFailures += 1
          if (!this.mounted) this.unmountFailures += 1
          this.handlers.onFailure()
          if (attemptedVersion !== this.desiredVersion) continue
          this.scheduleRetry()
          return
        }

        this.appliedRefresh = targetRefresh
        this.consecutiveFailures = 0
        if (!targetRefresh) this.stopRequired = false
        if (targetRefresh) this.handlers.onForegroundApplied()
      }
    } finally {
      this.draining = false
      if (this.needsTransition() && this.retryTimer === null) this.scheduleRetry()
    }
  }
}

const getOwnerClearRegistry = (dataLifecycle: AuthDataLifecycle): Map<string, OwnerClear> => {
  const existing = ownerClearRegistries.get(dataLifecycle)
  if (existing) return existing
  const created = new Map<string, OwnerClear>()
  ownerClearRegistries.set(dataLifecycle, created)
  return created
}

const getRefreshLifecycleController = (service: AuthService): RefreshLifecycleController => {
  const existing = refreshLifecycleControllers.get(service)
  if (existing) return existing
  const created = new RefreshLifecycleController(service)
  refreshLifecycleControllers.set(service, created)
  return created
}

const AuthContext = createContext<AuthState | null>(null)
const AuthenticatedOwnerLeaseContext = createContext<AuthenticatedOwnerLease | null>(null)
const AuthActionsContext = createContext<{
  signOut(scope?: 'local' | 'global'): Promise<void>
} | null>(null)

const STORAGE_MESSAGE = 'Secure authentication storage is unavailable.'
const LOCAL_DATA_MESSAGE = 'Local data could not be prepared securely.'
const SESSION_LIFECYCLE_MESSAGE = 'Authentication session lifecycle is unavailable.'
const defaultReplaceRoute = (route: SafeAuthRoute) => router.replace(route)
const localDataDiagnosticMessage = (error: unknown): string => {
  if (!__DEV__) return LOCAL_DATA_MESSAGE
  const detail = error instanceof Error ? error.message : String(error)
  return `${LOCAL_DATA_MESSAGE}\nDevelopment detail: ${detail}`
}

export const AuthProvider = ({
  dataLifecycle,
  service: suppliedService,
  appState = AppState,
  linking = Linking,
  replaceRoute = defaultReplaceRoute,
  aal2Guard = getRecentAal2Guard(),
  children,
}: AuthProviderProps) => {
  const [state, setState] = useState<AuthState>({ status: 'initializing' })
  const [ownerLease, setOwnerLease] = useState<AuthenticatedOwnerLease | null>(null)
  const ownerLeaseRef = useRef<AuthenticatedOwnerLease | null>(null)
  const service = useMemo(() => suppliedService ?? getAuthService(), [suppliedService])
  const lifecycleBlocks = useRef(new Set<LifecycleBlock>())
  const restoreSession = useRef<() => void>(() => {})
  const invalidateSession = useRef<() => void>(() => dataLifecycle.deactivateOwner())
  const actions = useMemo(() => ({
    async signOut(scope: 'local' | 'global' = 'local') {
      ownerLeaseRef.current = null
      aal2Guard.clear()
      aal2Guard.updateLease(null)
      setOwnerLease(null)
      invalidateSession.current()
      await service.signOut(scope)
    },
  }), [aal2Guard, service])

  useEffect(() => {
    let disposed = false
    let generation = 0
    let targetOwnerId: string | null = null
    let activeOwnerId = dataLifecycle.ownerBoundary?.getSnapshot().ownerId ?? null
    let callbackVersion = 0
    let sessionGeneration = sessionGenerationCounters.get(service) ?? 0
    let repositoryRevision = repositoryRevisionCounters.get(dataLifecycle) ?? 0
    const ownerClears = getOwnerClearRegistry(dataLifecycle)
    const advanceSessionGeneration = () => {
      sessionGeneration += 1
      sessionGenerationCounters.set(service, sessionGeneration)
    }
    const advanceRepositoryRevision = () => {
      repositoryRevision += 1
      repositoryRevisionCounters.set(dataLifecycle, repositoryRevision)
    }

    const publishLease = (ownerId: string) => {
      if (disposed) return
      const next = Object.freeze({ ownerId, sessionGeneration, repositoryRevision })
      ownerLeaseRef.current = next
      aal2Guard.updateLease(next)
      setOwnerLease(next)
    }

    const invalidateLease = () => {
      aal2Guard.clear()
      aal2Guard.updateLease(null)
      ownerLeaseRef.current = null
      if (!disposed) setOwnerLease(null)
    }

    dataLifecycle.deactivateOwner()
    advanceRepositoryRevision()
    invalidateLease()
    invalidateSession.current = () => {
      generation += 1
      targetOwnerId = null
      activeOwnerId = null
      advanceRepositoryRevision()
      invalidateLease()
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
          advanceRepositoryRevision()
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
      advanceRepositoryRevision()
      invalidateLease()
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

    const drainOwnerClears = async (currentGeneration: number): Promise<boolean> => {
      for (const [ownerId, record] of [...ownerClears.entries()]) {
        try {
          await startOwnerClear(ownerId, record.status === 'failed')
        } catch {
          failOwnerLifecycle(currentGeneration)
          return false
        }
        if (currentGeneration !== generation) return false
      }
      return currentGeneration === generation
    }

    const reconcile = async (session: AuthSession | null, event: AuthEvent) => {
      advanceSessionGeneration()
      if (
        event === 'SIGNED_OUT' ||
        event === 'TOKEN_REFRESHED' ||
        event === 'USER_UPDATED' ||
        event === 'INVALID_SESSION'
      ) {
        invalidateLease()
      }
      if (event === 'INVALID_SESSION') {
        targetOwnerId = null
        activeOwnerId = null
        advanceRepositoryRevision()
        dataLifecycle.deactivateOwner()
        showStorageError(STORAGE_MESSAGE)
        return
      }
      if (lifecycleBlocks.current.size > 0) {
        advanceRepositoryRevision()
        invalidateLease()
        dataLifecycle.deactivateOwner()
        return
      }
      const currentGeneration = ++generation
      const user = session?.user

      if (!user || !user.emailConfirmedAt) {
        const previousOwnerId = targetOwnerId ?? activeOwnerId
        targetOwnerId = null
        activeOwnerId = null
        if (previousOwnerId) {
          advanceRepositoryRevision()
          invalidateLease()
          dataLifecycle.deactivateOwner()
        }
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

      if (targetOwnerId === user.id && ownerClears.size === 0) {
        if (activeOwnerId === user.id) publishLease(user.id)
        return
      }
      const previousOwnerId = targetOwnerId ?? activeOwnerId
      targetOwnerId = user.id
      activeOwnerId = null
      if (previousOwnerId && previousOwnerId !== user.id) {
        advanceRepositoryRevision()
        invalidateLease()
        dataLifecycle.deactivateOwner()
      }
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
      if (!(await drainOwnerClears(currentGeneration))) return
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
        advanceRepositoryRevision()
      } catch (error) {
        if (__DEV__) {
          console.error('[FieldCraft boot] Local repository initialization failed.', error)
        }
        if (!disposed && currentGeneration === generation) {
          targetOwnerId = null
          advanceRepositoryRevision()
          invalidateLease()
          dataLifecycle.deactivateOwner()
          showStorageError(localDataDiagnosticMessage(error))
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
      if (
        dataLifecycle.hasCompletedInitialPull &&
        dataLifecycle.waitForInitialPull &&
        !(await dataLifecycle.hasCompletedInitialPull(user.id))
      ) {
        await dataLifecycle.waitForInitialPull(user.id)
        if (
          disposed ||
          lifecycleBlocks.current.size > 0 ||
          currentGeneration !== generation ||
          targetOwnerId !== user.id
        ) {
          return
        }
      }
      publishLease(user.id)
      setState({ status: 'signedIn', userId: user.id, email: user.email, hydrated: true })
    }

    let unsubscribe = () => {}
    try {
      unsubscribe = service.subscribe((event, session) => {
        callbackVersion += 1
        void reconcile(session, event)
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
            return reconcile(session, 'INITIAL_SESSION')
          }
        })
        .catch(() => {
          if (!disposed && callbackVersion === versionBeforeSession) {
            generation += 1
            targetOwnerId = null
            activeOwnerId = null
            advanceRepositoryRevision()
            invalidateLease()
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
      aal2Guard.clear()
      aal2Guard.updateLease(null)
      ownerLeaseRef.current = null
      restoreSession.current = () => {}
      invalidateSession.current = () => dataLifecycle.deactivateOwner()
      unsubscribe()
      dataLifecycle.deactivateOwner()
    }
  }, [aal2Guard, dataLifecycle, service])

  useEffect(() => {
    const boundary = dataLifecycle.ownerBoundary
    if (!boundary?.subscribe) return undefined
    const validateBoundary = () => {
      const lease = ownerLeaseRef.current
      if (lease && boundary.getSnapshot().ownerId !== lease.ownerId) {
        ownerLeaseRef.current = null
        aal2Guard.clear()
        aal2Guard.updateLease(null)
        setOwnerLease(null)
      }
    }
    validateBoundary()
    return boundary.subscribe(validateBoundary)
  }, [aal2Guard, dataLifecycle])

  useEffect(() => {
    let mounted = true

    const blockRefreshLifecycle = () => {
      lifecycleBlocks.current.add('refresh')
      aal2Guard.clear()
      invalidateSession.current()
    }

    const failRefreshLifecycle = () => {
      blockRefreshLifecycle()
      if (mounted) setState({ status: 'storageError', message: SESSION_LIFECYCLE_MESSAGE })
    }

    const controller = getRefreshLifecycleController(service)
    const initiallyActive = (appState.currentState ?? 'background') === 'active'
    if (!initiallyActive) blockRefreshLifecycle()
    const lease = controller.attach(initiallyActive, {
      onBlocked: () => lifecycleBlocks.current.add('refresh'),
      onFailure: failRefreshLifecycle,
      onForegroundApplied: () => {
        if (lifecycleBlocks.current.delete('refresh') && lifecycleBlocks.current.size === 0) {
          restoreSession.current()
        }
      },
    })
    const subscription = appState.addEventListener('change', (nextState) => {
      const shouldRefresh = nextState === 'active'
      if (!shouldRefresh) blockRefreshLifecycle()
      lease.update(shouldRefresh)
    })
    return () => {
      mounted = false
      subscription.remove()
      blockRefreshLifecycle()
      lease.release()
    }
  }, [aal2Guard, appState, dataLifecycle, service])

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

  return (
    <AuthActionsContext.Provider value={actions}>
      <AuthenticatedOwnerLeaseContext.Provider value={ownerLease}>
        <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
      </AuthenticatedOwnerLeaseContext.Provider>
    </AuthActionsContext.Provider>
  )
}

export const useAuth = (): AuthState => {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth must be used inside AuthProvider')
  return state
}

export const useAuthenticatedOwnerLease = (): AuthenticatedOwnerLease | null =>
  useContext(AuthenticatedOwnerLeaseContext)

export const useAuthActions = () => {
  const actions = useContext(AuthActionsContext)
  if (!actions) throw new Error('useAuthActions must be used inside AuthProvider')
  return actions
}
