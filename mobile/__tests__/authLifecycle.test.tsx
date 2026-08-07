import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { PropsWithChildren } from 'react'
import { Text } from 'react-native'

import {
  AuthProvider,
  type AuthDataLifecycle,
  type AppStateLifecycle,
  type AuthenticatedOwnerLease,
  type LinkingLifecycle,
  useAuthActions,
  useAuthenticatedOwnerLease,
  useAuth,
} from '../src/auth/AuthProvider'
import {
  AuthOperationError,
  createAuthService,
  type AuthEvent,
  type AuthService,
  type AuthSession,
} from '../src/auth/authService'
import { createRecentAal2Guard, type RecentAal2Guard } from '../src/auth/requireAal2'
import { SecureAuthStorageError } from '../src/auth/secureStoreAuthStorage'
import {
  createConfiguredSupabaseClient,
  SupabaseConfigurationError,
} from '../src/auth/supabase'
import LoginScreen from '../app/(auth)/login'
import SignupScreen from '../app/(auth)/signup'
import ResetPasswordScreen from '../app/(auth)/reset-password'
import OnboardingScreen from '../app/(auth)/onboarding'
import type { OnboardingProfileV1 } from '../src/domain/entities'

const CANONICAL_OWNER = '123e4567-e89b-12d3-a456-426614174000'
const SECOND_CANONICAL_OWNER = '223e4567-e89b-12d3-a456-426614174000'

const verifiedSession = (userId: string, email = `${userId}@example.com`): AuthSession => ({
  user: {
    id: userId,
    email,
    emailConfirmedAt: '2026-08-03T10:00:00.000Z',
  },
})

class FakeAuthService implements AuthService {
  session: AuthSession | null = null
  sessionError: unknown = null
  readonly listeners = new Set<(event: AuthEvent, session: AuthSession | null) => void>()
  starts = 0
  stops = 0
  refreshRunning = false
  startGate: Promise<void> | null = null
  stopGate: Promise<void> | null = null
  readonly startGates: Promise<void>[] = []
  readonly stopGates: Promise<void>[] = []
  startFailures = 0
  stopFailures = 0
  transitionsInFlight = 0
  maxTransitionsInFlight = 0

  async getSession(): Promise<AuthSession | null> {
    if (this.sessionError) throw this.sessionError
    return this.session
  }

  subscribe(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(session: AuthSession | null, event: AuthEvent = session ? 'SIGNED_IN' : 'SIGNED_OUT'): void {
    this.session = session
    for (const listener of this.listeners) listener(event, session)
  }

  async startAutoRefresh(): Promise<void> {
    this.starts += 1
    this.transitionsInFlight += 1
    this.maxTransitionsInFlight = Math.max(
      this.maxTransitionsInFlight,
      this.transitionsInFlight,
    )
    try {
      await (this.startGates[this.starts - 1] ?? this.startGate ?? Promise.resolve())
      if (this.startFailures > 0) {
        this.startFailures -= 1
        throw new Error('start refresh provider-secret')
      }
      this.refreshRunning = true
    } finally {
      this.transitionsInFlight -= 1
    }
  }

  async stopAutoRefresh(): Promise<void> {
    this.stops += 1
    this.transitionsInFlight += 1
    this.maxTransitionsInFlight = Math.max(
      this.maxTransitionsInFlight,
      this.transitionsInFlight,
    )
    try {
      await (this.stopGates[this.stops - 1] ?? this.stopGate ?? Promise.resolve())
      if (this.stopFailures > 0) {
        this.stopFailures -= 1
        throw new Error('stop refresh provider-secret')
      }
      this.refreshRunning = false
    } finally {
      this.transitionsInFlight -= 1
    }
  }

  async signIn(): Promise<void> {}
  async signUp(): Promise<{ verificationRequired: boolean }> {
    return { verificationRequired: true }
  }
  async requestPasswordReset(): Promise<void> {}
  async updatePassword(): Promise<void> {}
  async signOut(_scope: 'local' | 'global' = 'local'): Promise<void> {}
  async exchangeCode(): Promise<void> {}
  async verifySignup(): Promise<void> {}
  async recoverPassword(): Promise<void> {}
}

class FakeDataLifecycle implements AuthDataLifecycle {
  readonly calls: string[] = []
  readonly initializers = new Map<string, Promise<void>>()
  readonly clearers = new Map<string, Promise<void>>()
  readonly clearFailures = new Set<string>()
  readonly retainedOwners = new Set<string>()
  activeOwnerId: string | null = null

  async initialize(ownerId: string): Promise<void> {
    this.calls.push(`initialize:${ownerId}`)
    await (this.initializers.get(ownerId) ?? Promise.resolve())
    this.retainedOwners.add(ownerId)
    this.activeOwnerId = ownerId
  }

  deactivateOwner(): void {
    this.calls.push('deactivate')
    this.activeOwnerId = null
  }

  async clearOwner(ownerId: string): Promise<void> {
    this.calls.push(`clear:${ownerId}`)
    await (this.clearers.get(ownerId) ?? Promise.resolve())
    if (this.clearFailures.has(ownerId)) throw new Error('clear failed: provider-secret')
    this.retainedOwners.delete(ownerId)
    if (this.activeOwnerId === ownerId) this.activeOwnerId = null
  }
}

class ObservableDataLifecycle extends FakeDataLifecycle {
  private boundaryOwnerId: string | null = null
  private readonly boundaryListeners = new Set<() => void>()
  readonly ownerBoundary = {
    getSnapshot: () => ({ ownerId: this.boundaryOwnerId }),
    subscribe: (listener: () => void) => {
      this.boundaryListeners.add(listener)
      return () => this.boundaryListeners.delete(listener)
    },
  }

  private publishBoundary(ownerId: string | null) {
    this.boundaryOwnerId = ownerId
    for (const listener of this.boundaryListeners) listener()
  }

  override async initialize(ownerId: string): Promise<void> {
    await super.initialize(ownerId)
    this.publishBoundary(ownerId)
  }

  override deactivateOwner(): void {
    super.deactivateOwner()
    this.publishBoundary(null)
  }
}

class FirstPullDataLifecycle extends FakeDataLifecycle {
  private readonly hydratedOwners = new Set<string>()
  private readonly waiters = new Map<string, (() => void)[]>()

  async hasCompletedInitialPull(ownerId: string): Promise<boolean> {
    return this.hydratedOwners.has(ownerId)
  }

  waitForInitialPull(ownerId: string): Promise<void> {
    if (this.hydratedOwners.has(ownerId)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.waiters.set(ownerId, [...(this.waiters.get(ownerId) ?? []), resolve])
    })
  }

  completeInitialPull(ownerId: string): void {
    this.hydratedOwners.add(ownerId)
    for (const resolve of this.waiters.get(ownerId) ?? []) resolve()
    this.waiters.delete(ownerId)
  }
}

class FakeAppState implements AppStateLifecycle {
  currentState: string | null = 'active'
  private readonly listeners = new Set<(state: string) => void>()

  addEventListener(_event: 'change', listener: (state: string) => void) {
    this.listeners.add(listener)
    return { remove: () => this.listeners.delete(listener) }
  }

  emit(state: string): void {
    this.currentState = state
    for (const listener of this.listeners) listener(state)
  }
}

class FakeLinking implements LinkingLifecycle {
  constructor(readonly initialURL: string | null) {}

  async getInitialURL(): Promise<string | null> {
    return this.initialURL
  }

  addEventListener(event: 'url', listener: (event: { url: string }) => void) {
    void event
    void listener
    return { remove: () => {} }
  }
}

const StateProbe = () => <Text testID="auth-state">{JSON.stringify(useAuth())}</Text>
let observedLease: AuthenticatedOwnerLease | null = null
let observedSignOut: ((scope?: 'local' | 'global') => Promise<void>) | null = null
let observedVerifyMfaChallenge: ((challenge: () => Promise<void>, verifiedAt?: number) => Promise<void>) | null = null
const LeaseProbe = () => {
  observedLease = useAuthenticatedOwnerLease()
  const actions = useAuthActions()
  observedSignOut = actions.signOut
  observedVerifyMfaChallenge = actions.verifyMfaChallenge
  return <Text testID="owner-lease">{JSON.stringify(observedLease)}</Text>
}

const renderProvider = (
  service: FakeAuthService,
  dataLifecycle = new FakeDataLifecycle(),
  appState = new FakeAppState(),
) => {
  const Wrapper = ({ children }: PropsWithChildren) => (
    <AuthProvider service={service} dataLifecycle={dataLifecycle} appState={appState}>
      {children}
    </AuthProvider>
  )
  return {
    ...render(<StateProbe />, { wrapper: Wrapper }),
    appState,
    dataLifecycle,
  }
}

const readState = () => JSON.parse(screen.getByTestId('auth-state').props.children as string)
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

it('keeps first-login cached app data unhydrated until a full cloud pull, then permits offline revisit', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FirstPullDataLifecycle()
  const first = renderProvider(service, dataLifecycle)

  await waitFor(() => expect(readState()).toMatchObject({
    status: 'signedIn',
    userId: 'owner-a',
    hydrated: false,
  }))
  expect(dataLifecycle.activeOwnerId).toBe('owner-a')

  act(() => dataLifecycle.completeInitialPull('owner-a'))
  await waitFor(() => expect(readState()).toMatchObject({ hydrated: true }))
  first.unmount()

  const revisit = renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({
    status: 'signedIn',
    userId: 'owner-a',
    hydrated: true,
  }))
  revisit.unmount()
})

it('rejects noncanonical session owners and preserves auth events and sign-out scope', async () => {
  const signOut = jest.fn().mockResolvedValue({ data: {}, error: null })
  const callbacks: Array<(event: string, session: never) => void> = []
  const service = createAuthService({
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: {
          session: {
            user: {
              id: 'NOT-A-CANONICAL-UUID',
              email: 'person@example.com',
              email_confirmed_at: '2026-08-03T10:00:00.000Z',
            },
          },
        },
        error: null,
      }),
      onAuthStateChange: (callback) => {
        callbacks.push(callback as never)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      signOut,
    },
  })

  await expect(service.getSession()).rejects.toMatchObject({ code: 'INVALID_SESSION_OWNER' })
  const listener = jest.fn()
  service.subscribe(listener)
  callbacks[0]('TOKEN_REFRESHED', {
    user: {
      id: CANONICAL_OWNER,
      email: 'person@example.com',
      email_confirmed_at: '2026-08-03T10:00:00.000Z',
    },
  } as never)
  expect(listener).toHaveBeenCalledWith('TOKEN_REFRESHED', verifiedSession(
    CANONICAL_OWNER,
    'person@example.com',
  ))

  await service.signOut('local')
  await service.signOut('global')
  expect(signOut.mock.calls).toEqual([[{ scope: 'local' }], [{ scope: 'global' }]])
})

it('rotates an immutable owner lease on token refresh and removes it before owner teardown', async () => {
  let finishClear!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  const view = render(
    <AuthProvider appState={appState} dataLifecycle={dataLifecycle} service={service}>
      <LeaseProbe />
    </AuthProvider>,
  )

  const readLease = (): AuthenticatedOwnerLease | null =>
    JSON.parse(screen.getByTestId('owner-lease').props.children as string)
  await waitFor(() => expect(readLease()?.ownerId).toBe(CANONICAL_OWNER))
  const first = readLease()!
  expect(Object.isFrozen(observedLease)).toBe(true)

  act(() => service.emit(verifiedSession(CANONICAL_OWNER), 'TOKEN_REFRESHED'))
  await waitFor(() => expect(readLease()?.sessionGeneration).toBeGreaterThan(first.sessionGeneration))
  const refreshed = readLease()!
  expect(refreshed.repositoryRevision).toBe(first.repositoryRevision)

  dataLifecycle.clearers.set(CANONICAL_OWNER, new Promise<void>((resolve) => {
    finishClear = resolve
  }))
  act(() => service.emit(verifiedSession(SECOND_CANONICAL_OWNER), 'SIGNED_IN'))
  expect(readLease()).toBeNull()
  expect(dataLifecycle.calls).not.toContain(`initialize:${SECOND_CANONICAL_OWNER}`)
  finishClear()
  await waitFor(() => expect(readLease()?.ownerId).toBe(SECOND_CANONICAL_OWNER))
  expect(readLease()).not.toEqual(refreshed)
  view.unmount()
})

it('invalidates the owner lease when the initialized repository resets outside auth callbacks', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const dataLifecycle = new ObservableDataLifecycle()
  const view = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
      <LeaseProbe />
    </AuthProvider>,
  )
  const readLease = (): AuthenticatedOwnerLease | null =>
    JSON.parse(screen.getByTestId('owner-lease').props.children as string)
  await waitFor(() => expect(readLease()?.ownerId).toBe(CANONICAL_OWNER))

  act(() => dataLifecycle.deactivateOwner())

  await waitFor(() => expect(readLease()).toBeNull())
  view.unmount()
})

it('never reissues the same owner lease tuple after an auth-provider relaunch', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  const renderLease = () => render(
    <AuthProvider appState={appState} dataLifecycle={dataLifecycle} service={service}>
      <LeaseProbe />
    </AuthProvider>,
  )
  const readLease = (): AuthenticatedOwnerLease | null =>
    JSON.parse(screen.getByTestId('owner-lease').props.children as string)

  const firstView = renderLease()
  await waitFor(() => expect(readLease()?.ownerId).toBe(CANONICAL_OWNER))
  const firstLease = readLease()
  firstView.unmount()

  const secondView = renderLease()
  await waitFor(() => expect(readLease()?.ownerId).toBe(CANONICAL_OWNER))
  expect(readLease()).not.toEqual(firstLease)
  secondView.unmount()
})

it('invalidates repository access before a local or global provider sign-out can settle', async () => {
  let finishSignOut!: () => void
  const pendingSignOut = new Promise<void>((resolve) => { finishSignOut = resolve })
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  service.signOut = jest.fn(async () => pendingSignOut)
  const dataLifecycle = new FakeDataLifecycle()
  const view = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))

  let signingOut!: Promise<void>
  act(() => { signingOut = observedSignOut!('global') })

  expect(observedLease).toBeNull()
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')
  expect(service.signOut).toHaveBeenCalledWith('global')
  finishSignOut()
  await signingOut
  view.unmount()
})

it.each(['local', 'global'] as const)(
  'captures and clears the immutable prior owner during %s sign-out before admitting another owner',
  async (scope) => {
    const clearGate = deferred()
    const service = new FakeAuthService()
    service.session = verifiedSession(CANONICAL_OWNER)
    const dataLifecycle = new FakeDataLifecycle()
    const view = render(
      <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
        <LeaseProbe />
      </AuthProvider>,
    )
    await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
    dataLifecycle.clearers.set(CANONICAL_OWNER, clearGate.promise)

    let signingOut!: Promise<void>
    act(() => { signingOut = observedSignOut!(scope) })
    expect(observedLease).toBeNull()
    await waitFor(() => expect(dataLifecycle.calls).toContain(`clear:${CANONICAL_OWNER}`))

    act(() => service.emit(verifiedSession(SECOND_CANONICAL_OWNER), 'SIGNED_IN'))
    expect(dataLifecycle.calls).not.toContain(`initialize:${SECOND_CANONICAL_OWNER}`)

    await act(async () => {
      clearGate.resolve(undefined)
      await Promise.resolve()
    })
    await expect(signingOut).resolves.toBeUndefined()
    await waitFor(() => expect(dataLifecycle.calls).toContain(`initialize:${SECOND_CANONICAL_OWNER}`))
    view.unmount()
  },
)

it('finishes secure owner teardown and leaves a non-product state when provider sign-out fails', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  service.signOut = jest.fn(async () => { throw new Error('provider sign-out secret') })
  const dataLifecycle = new FakeDataLifecycle()
  const view = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
      <StateProbe />
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))

  await act(async () => {
    await expect(observedSignOut!('global')).rejects.toThrow('provider sign-out secret')
  })

  expect(observedLease).toBeNull()
  expect(dataLifecycle.retainedOwners).not.toContain(CANONICAL_OWNER)
  expect(readState().status).not.toBe('signedIn')
  expect(screen.getByTestId('auth-state').props.children).not.toContain('provider sign-out secret')
  view.unmount()
})

it('clears retained SQLite ownership on invalid-session callbacks and getSession failures', async () => {
  const invalidService = new FakeAuthService()
  invalidService.session = verifiedSession(CANONICAL_OWNER)
  const invalidData = new FakeDataLifecycle()
  const invalidView = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={invalidData} service={invalidService}>
      <StateProbe />
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  act(() => invalidService.emit(null, 'INVALID_SESSION'))
  await waitFor(() => expect(invalidData.calls).toContain(`clear:${CANONICAL_OWNER}`))
  expect(invalidData.retainedOwners).not.toContain(CANONICAL_OWNER)
  expect(readState()).toMatchObject({ status: 'storageError' })
  invalidView.unmount()

  const restoreService = new FakeAuthService()
  restoreService.sessionError = new Error('getSession provider secret')
  const restoreData = new ObservableDataLifecycle()
  await restoreData.initialize(CANONICAL_OWNER)
  const restoreView = renderProvider(restoreService, restoreData)
  await waitFor(() => expect(restoreData.calls).toContain(`clear:${CANONICAL_OWNER}`))
  expect(restoreData.retainedOwners).not.toContain(CANONICAL_OWNER)
  expect(readState()).toMatchObject({ status: 'storageError' })
  expect(screen.getByTestId('auth-state').props.children).not.toContain('getSession provider secret')
  restoreView.unmount()
})

it('retains failed owner clears across remount and drains them before hydrating the next owner', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const dataLifecycle = new FakeDataLifecycle()
  dataLifecycle.clearFailures.add(CANONICAL_OWNER)
  const first = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
      <StateProbe />
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  act(() => service.emit(null, 'INVALID_SESSION'))
  await waitFor(() => expect(readState()).toMatchObject({ status: 'storageError' }))
  expect(dataLifecycle.calls).toContain(`clear:${CANONICAL_OWNER}`)
  first.unmount()

  dataLifecycle.clearFailures.delete(CANONICAL_OWNER)
  service.session = verifiedSession(SECOND_CANONICAL_OWNER)
  const clearGate = deferred()
  dataLifecycle.clearers.set(CANONICAL_OWNER, clearGate.promise)
  const callsBeforeRemount = dataLifecycle.calls.length
  const second = render(
    <AuthProvider appState={new FakeAppState()} dataLifecycle={dataLifecycle} service={service}>
      <StateProbe />
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(
    dataLifecycle.calls.slice(callsBeforeRemount),
  ).toContain(`clear:${CANONICAL_OWNER}`))
  expect(dataLifecycle.calls.slice(callsBeforeRemount)).not.toContain(
    `initialize:${SECOND_CANONICAL_OWNER}`,
  )

  await act(async () => {
    clearGate.resolve(undefined)
    await Promise.resolve()
  })
  await waitFor(() => expect(observedLease?.ownerId).toBe(SECOND_CANONICAL_OWNER))
  second.unmount()
})

it('authorizes recent AAL2 only on the post-event lease and invalidates it on lifecycle changes', async () => {
  const guard: RecentAal2Guard = createRecentAal2Guard()
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  const view = render(
    <AuthProvider
      aal2Guard={guard}
      appState={appState}
      dataLifecycle={dataLifecycle}
      service={service}
    >
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  const preEventLease = observedLease!

  await act(async () => {
    await observedVerifyMfaChallenge!(async () => {
      service.emit(verifiedSession(CANONICAL_OWNER), 'MFA_CHALLENGE_VERIFIED')
    }, 1_000)
  })
  expect(observedLease!.sessionGeneration).toBeGreaterThan(preEventLease.sessionGeneration)
  expect(guard.requireRecentAal2('payment-link', 1_000 + 15 * 60_000)).toEqual(observedLease)
  const authorizedLease = observedLease!

  act(() => service.emit(verifiedSession(CANONICAL_OWNER), 'TOKEN_REFRESHED'))
  await waitFor(() => expect(observedLease?.sessionGeneration).toBeGreaterThan(
    authorizedLease.sessionGeneration,
  ))
  expect(() => guard.requireRecentAal2('payment-link', 1_001)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )

  await act(async () => {
    await observedVerifyMfaChallenge!(async () => {
      service.emit(verifiedSession(CANONICAL_OWNER), 'MFA_CHALLENGE_VERIFIED')
    }, 2_000)
  })
  expect(guard.requireRecentAal2('payment-link', 2_001)).toEqual(observedLease)
  act(() => appState.emit('background'))
  expect(() => guard.requireRecentAal2('payment-link', 2_002)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )

  act(() => appState.emit('active'))
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  await act(async () => {
    await observedVerifyMfaChallenge!(async () => {
      service.emit(verifiedSession(CANONICAL_OWNER), 'MFA_CHALLENGE_VERIFIED')
    }, 3_000)
  })
  act(() => service.emit(verifiedSession(SECOND_CANONICAL_OWNER), 'SIGNED_IN'))
  expect(() => guard.requireRecentAal2('payment-link', 3_001)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )
  view.unmount()
})

it('keeps a successful MFA challenge pending until the provider publishes its rotated lease', async () => {
  const guard = createRecentAal2Guard()
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const view = render(
    <AuthProvider
      aal2Guard={guard}
      appState={new FakeAppState()}
      dataLifecycle={new FakeDataLifecycle()}
      service={service}
    >
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  const preEventLease = observedLease!
  let settled = false
  const verification = observedVerifyMfaChallenge!(async () => {}).then(() => { settled = true })
  await act(async () => { await Promise.resolve() })

  expect(settled).toBe(false)
  expect(() => guard.requireRecentAal2('payment-link', 5_000)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )

  act(() => service.emit(verifiedSession(CANONICAL_OWNER), 'MFA_CHALLENGE_VERIFIED'))
  await act(async () => verification)
  expect(observedLease!.sessionGeneration).toBeGreaterThan(preEventLease.sessionGeneration)
  expect(guard.requireRecentAal2('payment-link', Date.now())).toEqual(observedLease)
  view.unmount()
})

it('invalidates an authorized AAL2 lease immediately on sign-out', async () => {
  const guard = createRecentAal2Guard()
  const service = new FakeAuthService()
  service.session = verifiedSession(CANONICAL_OWNER)
  const view = render(
    <AuthProvider
      aal2Guard={guard}
      appState={new FakeAppState()}
      dataLifecycle={new FakeDataLifecycle()}
      service={service}
    >
      <LeaseProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(observedLease?.ownerId).toBe(CANONICAL_OWNER))
  await act(async () => {
    await observedVerifyMfaChallenge!(async () => {
      service.emit(verifiedSession(CANONICAL_OWNER), 'MFA_CHALLENGE_VERIFIED')
    }, 4_000)
  })
  expect(guard.requireRecentAal2('delete-account', 4_001)).toEqual(observedLease)

  await act(async () => observedSignOut!('local'))
  expect(() => guard.requireRecentAal2('delete-account', 4_002)).toThrow(
    expect.objectContaining({ code: 'STEP_UP_REQUIRED' }),
  )
  view.unmount()
})

it('starts refresh only while active, stops in background, and cleans up on unmount', async () => {
  const service = new FakeAuthService()
  const { appState, unmount } = renderProvider(service)
  await waitFor(() => expect(service.starts).toBe(1))

  act(() => appState.emit('background'))
  await waitFor(() => expect(service.stops).toBe(1))
  act(() => appState.emit('active'))
  await waitFor(() => expect(service.starts).toBe(2))
  act(() => appState.emit('active'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(service.starts).toBe(2)

  unmount()
  await waitFor(() => expect(service.stops).toBe(2))
  expect(service.listeners.size).toBe(0)
  expect(service.maxTransitionsInFlight).toBe(1)
})

it('finishes a delayed foreground start by stopping refresh when background wins the race', async () => {
  let finishStart!: () => void
  const service = new FakeAuthService()
  service.startGate = new Promise<void>((resolve) => {
    finishStart = resolve
  })
  const { appState, unmount } = renderProvider(service)
  await waitFor(() => expect(service.starts).toBe(1))

  act(() => appState.emit('background'))
  finishStart()

  await waitFor(() => expect(service.stops).toBe(1))
  expect(service.refreshRunning).toBe(false)
  expect(service.maxTransitionsInFlight).toBe(1)
  unmount()
})

it('deactivates owner access while a background stop is still pending', async () => {
  let finishStop!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { appState, dataLifecycle } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  service.stopGate = new Promise<void>((resolve) => {
    finishStop = resolve
  })

  act(() => appState.emit('background'))
  await waitFor(() => expect(service.stops).toBe(1))

  expect(dataLifecycle.activeOwnerId).toBe(null)
  expect(service.refreshRunning).toBe(true)

  act(() => appState.emit('active'))
  expect(service.starts).toBe(1)
  service.stopGate = null
  act(() => finishStop())
  await waitFor(() => expect(service.starts).toBe(2))
  await waitFor(() => expect(dataLifecycle.activeOwnerId).toBe('owner-a'))
})

it('fails closed on foreground refresh rejection and retries without another AppState event', async () => {
  let finishRetry!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  service.startFailures = 1
  service.startGates[1] = new Promise<void>((resolve) => {
    finishRetry = resolve
  })
  const { appState, dataLifecycle } = renderProvider(service)

  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'storageError',
      message: 'Authentication session lifecycle is unavailable.',
    }),
  )
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')
  expect(service.refreshRunning).toBe(false)

  await waitFor(() => expect(service.starts).toBe(2))
  act(() => finishRetry())
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(appState.currentState).toBe('active')
})

it('retries a failed background stop without another event and keeps owner access closed', async () => {
  let finishRetry!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { appState, dataLifecycle } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(service.refreshRunning).toBe(true)
  service.stopFailures = 1
  service.stopGates[1] = new Promise<void>((resolve) => {
    finishRetry = resolve
  })

  act(() => appState.emit('background'))
  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'storageError',
      message: 'Authentication session lifecycle is unavailable.',
    }),
  )
  expect(service.refreshRunning).toBe(true)
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')

  await waitFor(() => expect(service.stops).toBe(2))
  expect(readState().status).toBe('storageError')
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')
  act(() => finishRetry())
  await waitFor(() => expect(service.refreshRunning).toBe(false))
  expect(service.refreshRunning).toBe(false)
  expect(readState().status).toBe('storageError')

  act(() => appState.emit('active'))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
})

it('reasserts foreground refresh when a stale background stop rejects after returning active', async () => {
  let rejectStop!: (error: Error) => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { appState } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  service.stopGate = new Promise<void>((_resolve, reject) => {
    rejectStop = reject
  })

  act(() => appState.emit('background'))
  await waitFor(() => expect(service.stops).toBe(1))
  act(() => appState.emit('active'))
  service.stopGate = null
  rejectStop(new Error('stale background stop failed'))

  await waitFor(() => expect(service.stops).toBe(2))
  await waitFor(() => expect(service.starts).toBe(2))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(service.refreshRunning).toBe(true)
  expect(service.maxTransitionsInFlight).toBe(1)
})

it('finishes required stop retries before a newer foreground start without overlapping calls', async () => {
  let finishSecondStop!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { appState } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  service.stopFailures = 2
  service.stopGates[1] = new Promise<void>((resolve) => {
    finishSecondStop = resolve
  })

  act(() => appState.emit('background'))
  await waitFor(() => expect(service.stops).toBe(2))
  act(() => appState.emit('active'))
  act(() => finishSecondStop())

  await waitFor(() => expect(service.stops).toBe(3))
  await waitFor(() => expect(service.starts).toBe(2))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(service.refreshRunning).toBe(true)
  expect(service.maxTransitionsInFlight).toBe(1)
})

it('retries a failed unmount stop without another lifecycle event', async () => {
  const service = new FakeAuthService()
  const { unmount } = renderProvider(service)
  await waitFor(() => expect(service.starts).toBe(1))
  service.stopFailures = 1

  unmount()

  await waitFor(() => expect(service.stops).toBe(2))
  expect(service.refreshRunning).toBe(false)
  expect(service.maxTransitionsInFlight).toBe(1)
})

it('bounds unmount failures and resumes the required stop before starting after remount', async () => {
  let finishRemountStop!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  service.stopFailures = 3
  service.stopGates[3] = new Promise<void>((resolve) => {
    finishRemountStop = resolve
  })
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  const first = renderProvider(service, dataLifecycle, appState)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))

  first.unmount()
  await waitFor(() => expect(service.stops).toBe(3))
  await new Promise((resolve) => setTimeout(resolve, 60))
  expect(service.stops).toBe(3)
  expect(dataLifecycle.activeOwnerId).toBe(null)

  const second = renderProvider(service, dataLifecycle, appState)
  await waitFor(() => expect(service.stops).toBe(4))
  expect(service.starts).toBe(1)
  expect(dataLifecycle.activeOwnerId).toBe(null)

  act(() => finishRemountStop())
  await waitFor(() => expect(service.starts).toBe(2))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(service.maxTransitionsInFlight).toBe(1)
  second.unmount()
})

it('keeps a remount closed while the previous unmount stop remains pending', async () => {
  let finishUnmountStop!: () => void
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  const first = renderProvider(service, dataLifecycle, appState)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  service.stopGate = new Promise<void>((resolve) => {
    finishUnmountStop = resolve
  })

  first.unmount()
  await waitFor(() => expect(service.stops).toBe(1))
  const second = renderProvider(service, dataLifecycle, appState)
  await act(async () => Promise.resolve())

  expect(dataLifecycle.activeOwnerId).toBe(null)
  expect(service.starts).toBe(1)

  service.stopGate = null
  act(() => finishUnmountStop())
  await waitFor(() => expect(service.starts).toBe(2))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  second.unmount()
})

it('invalidates and clears the signed-out owner before exposing signed-out state', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { dataLifecycle } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ status: 'signedIn', hydrated: true }))

  act(() => service.emit(null))

  expect(readState()).toEqual({ status: 'signedOut' })
  await waitFor(() => expect(dataLifecycle.calls).toContain('clear:owner-a'))
  expect(dataLifecycle.calls.slice(-2)).toEqual(['deactivate', 'clear:owner-a'])
})

it('awaits an outstanding owner clear before the same verified owner can hydrate again', async () => {
  let finishClear!: () => void
  const pendingClear = new Promise<void>((resolve) => {
    finishClear = resolve
  })
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  const rendered = renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearers.set('owner-a', pendingClear)

  act(() => service.emit(null))
  await waitFor(() => expect(dataLifecycle.calls).toContain('clear:owner-a'))
  act(() => service.emit(verifiedSession('owner-a')))

  expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: false })
  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-a')).toHaveLength(1)
  finishClear()
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-a')).toHaveLength(2)
  rendered.unmount()
})

it('drains owner A clear before B can hydrate after an intervening signed-out callback', async () => {
  let finishClear!: () => void
  const pendingClear = new Promise<void>((resolve) => {
    finishClear = resolve
  })
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearers.set('owner-a', pendingClear)

  act(() => service.emit(null))
  await waitFor(() => expect(dataLifecycle.calls).toContain('clear:owner-a'))
  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: false }))
  await act(async () => Promise.resolve())

  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-b')).toHaveLength(0)
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(true)

  act(() => finishClear())
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(false)
})

it('does not let repeated B callbacks bypass a failed owner A clear', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearFailures.add('owner-a')

  act(() => service.emit(null))
  await waitFor(() => expect(readState().status).toBe('storageError'))
  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState().status).toBe('storageError'))
  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() =>
    expect(dataLifecycle.calls.filter((call) => call === 'clear:owner-a')).toHaveLength(3),
  )

  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-b')).toHaveLength(0)
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(true)

  dataLifecycle.clearFailures.delete('owner-a')
  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(false)
})

it('fails a direct A-to-B switch closed until owner A clearing succeeds', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearFailures.add('owner-a')

  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState().status).toBe('storageError'))
  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-b')).toHaveLength(0)
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(true)

  dataLifecycle.clearFailures.delete('owner-a')
  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(false)
})

it('retries every unresolved prior-owner clear after provider remount before B hydration', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  const first = renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearFailures.add('owner-a')

  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState().status).toBe('storageError'))
  first.unmount()
  dataLifecycle.clearFailures.delete('owner-a')
  service.session = verifiedSession('owner-b')

  const second = renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  expect(dataLifecycle.calls.filter((call) => call === 'clear:owner-a')).toHaveLength(2)
  expect(dataLifecycle.retainedOwners.has('owner-a')).toBe(false)
  second.unmount()
})

it('retains an outstanding owner-clear gate across provider remount', async () => {
  let finishClear!: () => void
  const pendingClear = new Promise<void>((resolve) => {
    finishClear = resolve
  })
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-remount')
  const dataLifecycle = new FakeDataLifecycle()
  const first = renderProvider(service, dataLifecycle)
  await waitFor(() =>
    expect(readState()).toMatchObject({ userId: 'owner-remount', hydrated: true }),
  )
  dataLifecycle.clearers.set('owner-remount', pendingClear)
  act(() => service.emit(null))
  await waitFor(() => expect(dataLifecycle.calls).toContain('clear:owner-remount'))
  first.unmount()

  service.session = verifiedSession('owner-remount')
  const second = renderProvider(service, dataLifecycle)
  await waitFor(() =>
    expect(readState()).toMatchObject({ userId: 'owner-remount', hydrated: false }),
  )
  expect(
    dataLifecycle.calls.filter((call) => call === 'initialize:owner-remount'),
  ).toHaveLength(1)
  finishClear()
  await waitFor(() =>
    expect(readState()).toMatchObject({ userId: 'owner-remount', hydrated: true }),
  )
  expect(
    dataLifecycle.calls.filter((call) => call === 'initialize:owner-remount'),
  ).toHaveLength(2)
  second.unmount()
})

it('keeps owner access fail-closed when an outstanding clear rejects', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))
  dataLifecycle.clearFailures.add('owner-a')

  act(() => service.emit(null))
  await waitFor(() => expect(readState().status).toBe('storageError'))
  act(() => service.emit(verifiedSession('owner-a')))

  await waitFor(() => expect(readState().status).toBe('storageError'))
  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-a')).toHaveLength(1)
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')
})

it('clears a stale owner that was active before the auth provider mounted', async () => {
  const service = new FakeAuthService()
  const dataLifecycle = new FakeDataLifecycle() as FakeDataLifecycle & {
    ownerBoundary: { getSnapshot(): { ownerId: string | null } }
  }
  dataLifecycle.ownerBoundary = { getSnapshot: () => ({ ownerId: 'orphaned-owner' }) }
  renderProvider(service, dataLifecycle)

  await waitFor(() => expect(readState()).toEqual({ status: 'signedOut' }))
  await waitFor(() => expect(dataLifecycle.calls).toContain('clear:orphaned-owner'))
  expect(dataLifecycle.calls).toEqual(['deactivate', 'deactivate', 'clear:orphaned-owner'])
})

it('clears owner A and finishes owner B hydration before making B data available', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const { dataLifecycle } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: true }))

  act(() => service.emit(verifiedSession('owner-b')))

  expect(readState()).toEqual({
    status: 'signedIn',
    userId: 'owner-b',
    email: 'owner-b@example.com',
    hydrated: false,
  })
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  expect(dataLifecycle.calls).toEqual([
    'deactivate',
    'initialize:owner-a',
    'deactivate',
    'clear:owner-a',
    'initialize:owner-b',
  ])
})

it('requires email verification and never activates an unverified owner', async () => {
  const service = new FakeAuthService()
  service.session = {
    user: { id: 'owner-a', email: 'person@example.com', emailConfirmedAt: null },
  }
  const { dataLifecycle } = renderProvider(service)

  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'verificationRequired',
      email: 'person@example.com',
    }),
  )
  expect(dataLifecycle.calls).toEqual(['deactivate'])
})

it('coalesces duplicate session callbacks without repeating hydration', async () => {
  const service = new FakeAuthService()
  const session = verifiedSession('owner-a')
  service.session = session
  const { dataLifecycle } = renderProvider(service)
  await waitFor(() => expect(readState()).toMatchObject({ status: 'signedIn', hydrated: true }))

  act(() => {
    service.emit(session)
    service.emit(session)
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(dataLifecycle.calls.filter((call) => call === 'initialize:owner-a')).toHaveLength(1)
})

it('ignores stale owner A hydration after owner B becomes current', async () => {
  let finishOwnerA!: () => void
  const ownerAHydration = new Promise<void>((resolve) => {
    finishOwnerA = resolve
  })
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  const dataLifecycle = new FakeDataLifecycle()
  dataLifecycle.initializers.set('owner-a', ownerAHydration)
  renderProvider(service, dataLifecycle)
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-a', hydrated: false }))

  act(() => service.emit(verifiedSession('owner-b')))
  await waitFor(() => expect(readState()).toMatchObject({ userId: 'owner-b', hydrated: true }))
  finishOwnerA()
  await new Promise((resolve) => setTimeout(resolve, 0))

  expect(readState()).toEqual({
    status: 'signedIn',
    userId: 'owner-b',
    email: 'owner-b@example.com',
    hydrated: true,
  })
})

it('surfaces SecureStore startup failures with a stable content-free state', async () => {
  const service = new FakeAuthService()
  service.sessionError = new SecureAuthStorageError()
  renderProvider(service)

  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'storageError',
      message: 'Secure authentication storage is unavailable.',
    }),
  )
  expect(JSON.stringify(readState())).not.toContain('provider-secret')
})

it('keeps subscription setup failure terminal and never restores or hydrates a session', async () => {
  const service = new FakeAuthService()
  service.session = verifiedSession('owner-a')
  service.subscribe = jest.fn(() => {
    throw new Error('listener provider-secret')
  })
  service.getSession = jest.fn(service.getSession.bind(service))
  const { dataLifecycle, unmount } = renderProvider(service)

  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'storageError',
      message: 'Secure authentication storage is unavailable.',
    }),
  )
  expect(service.getSession).not.toHaveBeenCalled()
  expect(dataLifecycle.calls.length).toBeGreaterThanOrEqual(1)
  expect(dataLifecycle.calls.every((call) => call === 'deactivate')).toBe(true)
  unmount()
  expect(dataLifecycle.calls.at(-1)).toBe('deactivate')
})

it('requests password reset on the exact native route and redacts provider errors', async () => {
  const resetPasswordForEmail = jest
    .fn()
    .mockResolvedValue({ data: {}, error: new Error('provider reset body: sensitive-token') })
  const service = createAuthService({
    auth: {
      resetPasswordForEmail,
    },
  })

  await expect(service.requestPasswordReset('person@example.com')).rejects.toEqual(
    new AuthOperationError('Unable to send a reset email. Please try again.'),
  )
  expect(resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', {
    redirectTo: 'fieldcraft://auth/reset',
  })

  const rejectedService = createAuthService({
    auth: {
      resetPasswordForEmail: jest.fn().mockRejectedValue(
        new Error('provider rejection: another-sensitive-token'),
      ),
    },
  })
  const failure = await rejectedService
    .requestPasswordReset('person@example.com')
    .catch((error: unknown) => error)
  expect(failure).toEqual(
    new AuthOperationError('Unable to send a reset email. Please try again.'),
  )
  expect(failure).not.toHaveProperty('cause')
})

it('requires verification when signup returns an unconfirmed session', async () => {
  const signUp = jest.fn().mockResolvedValue({
    data: {
      session: {
        user: { email_confirmed_at: null },
      },
    },
    error: null,
  })
  const service = createAuthService({ auth: { signUp } })

  await expect(service.signUp('person@example.com', 'correct-horse-battery')).resolves.toEqual({
    verificationRequired: true,
  })
})

it.each([
  [{}, 'missing values'],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://your-project-id.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    },
    'documented URL example',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'your-anon-key-here',
    },
    'documented key example',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    },
    'arbitrary public-looking key',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_',
    },
    'malformed modern key',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_privileged-value',
    },
    'modern secret key',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
    },
    'legacy service-role JWT',
  ],
  [
    {
      EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'header.not-json.signature',
    },
    'malformed legacy JWT',
  ],
] as const)('rejects unsafe Supabase configuration: %s', (env, _label) => {
  void _label
  expect(() => createConfiguredSupabaseClient({ env })).toThrow(SupabaseConfigurationError)
})

it('configures Supabase with secure persistence, PKCE, process locking, and manual URL handling', () => {
  const client = { auth: {} }
  const clientFactory = jest.fn(() => client)
  const storage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  }

  expect(
    createConfiguredSupabaseClient({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-value',
      },
      clientFactory,
      storage,
    }),
  ).toBe(client)
  expect(clientFactory).toHaveBeenCalledWith(
    'https://project-ref.supabase.co',
    'sb_publishable_public-value',
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
        lock: expect.any(Function),
        persistSession: true,
        storage,
      },
    },
  )
})

it('accepts only a legacy JWT whose decoded role is exactly anon', () => {
  const client = { auth: {} }
  const clientFactory = jest.fn(() => client)
  const anonJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.signature'

  expect(
    createConfiguredSupabaseClient({
      env: {
        EXPO_PUBLIC_SUPABASE_URL: 'https://project-ref.supabase.co',
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonJwt,
      },
      clientFactory,
    }),
  ).toBe(client)
  expect(clientFactory).toHaveBeenCalledWith(
    'https://project-ref.supabase.co',
    anonJwt,
    expect.any(Object),
  )
})

it('cancels old-provider navigation and deduplicates an initial auth URL across remount', async () => {
  let finishVerification!: () => void
  const verification = new Promise<void>((resolve) => {
    finishVerification = resolve
  })
  const service = new FakeAuthService()
  service.verifySignup = jest.fn(async () => verification)
  const dataLifecycle = new FakeDataLifecycle()
  const appState = new FakeAppState()
  appState.currentState = 'background'
  const linking = new FakeLinking(
    'fieldcraft://auth/verify?token_hash=remount-sensitive-token&type=signup',
  )
  const firstReplace = jest.fn()
  const first = render(
    <AuthProvider
      appState={appState}
      dataLifecycle={dataLifecycle}
      linking={linking}
      replaceRoute={firstReplace}
      service={service}
    >
      <StateProbe />
    </AuthProvider>,
  )
  await waitFor(() => expect(service.verifySignup).toHaveBeenCalledTimes(1))
  first.unmount()

  const secondReplace = jest.fn()
  const second = render(
    <AuthProvider
      appState={appState}
      dataLifecycle={dataLifecycle}
      linking={linking}
      replaceRoute={secondReplace}
      service={service}
    >
      <StateProbe />
    </AuthProvider>,
  )
  finishVerification()

  await waitFor(() => expect(secondReplace).toHaveBeenCalledWith('/(auth)/verify-email'))
  expect(service.verifySignup).toHaveBeenCalledTimes(1)
  expect(firstReplace).not.toHaveBeenCalled()
  second.unmount()
})

it('retains email, clears the password, announces a stable error, and blocks duplicate sign-in', async () => {
  let rejectSignIn!: (error: Error) => void
  const pendingSignIn = new Promise<void>((_resolve, reject) => {
    rejectSignIn = reject
  })
  const service = new FakeAuthService()
  service.signIn = jest.fn(async () => pendingSignIn)
  render(<LoginScreen service={service} onSuccess={jest.fn()} />)
  fireEvent.changeText(screen.getByLabelText('Email address'), 'person@example.com')
  fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery')

  const signInButton = screen.getByRole('button', { name: 'Sign in' })
  fireEvent.press(signInButton)
  fireEvent.press(signInButton)
  expect(service.signIn).toHaveBeenCalledTimes(1)
  rejectSignIn(new Error('provider body: sensitive-password'))

  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to sign in. Check your details and try again.',
    ),
  )
  expect(screen.getByLabelText('Email address').props.value).toBe('person@example.com')
  expect(screen.getByLabelText('Password').props.value).toBe('')
  expect(JSON.stringify(screen.toJSON())).not.toContain('sensitive-password')
})

it('rejects overlong signup fields before calling the provider', async () => {
  const service = new FakeAuthService()
  service.signUp = jest.fn(async () => ({ verificationRequired: true }))
  render(<SignupScreen service={service} onVerificationRequired={jest.fn()} />)
  fireEvent.changeText(screen.getByLabelText('Email address'), `${'a'.repeat(250)}@example.com`)
  fireEvent.changeText(screen.getByLabelText('Password'), 'correct-horse-battery')

  fireEvent.press(screen.getByRole('button', { name: 'Create account' }))

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(service.signUp).not.toHaveBeenCalled()
})

it('clears both recovery secrets after a stable password-update failure', async () => {
  const service = new FakeAuthService()
  service.updatePassword = jest.fn(async () => {
    throw new Error('raw provider reset error')
  })
  render(<ResetPasswordScreen service={service} onSuccess={jest.fn()} />)
  fireEvent.changeText(screen.getByLabelText('New password'), 'correct-horse-battery')
  fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'correct-horse-battery')

  fireEvent.press(screen.getByRole('button', { name: 'Update password' }))

  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(screen.getByLabelText('New password').props.value).toBe('')
  expect(screen.getByLabelText('Confirm new password').props.value).toBe('')
  expect(JSON.stringify(screen.toJSON())).not.toContain('raw provider reset error')
})

it('submits the complete bounded onboarding profile once on a duplicate tap', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  const onComplete = jest.fn<Promise<void>, [OnboardingProfileV1]>(async () => pending)
  render(<OnboardingScreen onComplete={onComplete} now={() => '2026-08-07T18:00:00.000Z'} timeZone="America/Los_Angeles" />)
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Avi Builder')
  fireEvent.changeText(screen.getByLabelText('Business name'), 'FieldCraft Plumbing')
  fireEvent.changeText(screen.getByLabelText('Trade'), 'Plumbing')
  fireEvent.changeText(screen.getByLabelText('Hourly rate'), '125.50')
  fireEvent.changeText(screen.getByLabelText('Tax percent'), '8.75')
  fireEvent.changeText(screen.getByLabelText('Payment terms'), 'Net 30')

  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }))
  fireEvent.press(screen.getByRole('button', { name: 'Saving…' }))

  await waitFor(() =>
    expect(onComplete).toHaveBeenCalledWith({
      displayName: 'Avi Builder',
      businessName: 'FieldCraft Plumbing',
      tradeType: 'Plumbing',
      hourlyRateCents: 12_550,
      taxBasisPoints: 875,
      paymentTerms: 'Net 30',
      countryCode: 'US',
      currency: 'USD',
      timeZone: 'America/Los_Angeles',
      onboardingVersion: 1,
      onboardingCompletedAt: '2026-08-07T18:00:00.000Z',
    }),
  )
  expect(onComplete).toHaveBeenCalledTimes(1)
  expect(Object.keys(onComplete.mock.calls[0][0]).sort()).toEqual([
    'businessName',
    'countryCode',
    'currency',
    'displayName',
    'hourlyRateCents',
    'onboardingCompletedAt',
    'onboardingVersion',
    'paymentTerms',
    'taxBasisPoints',
    'timeZone',
    'tradeType',
  ].sort())
  await act(async () => finish())
})
