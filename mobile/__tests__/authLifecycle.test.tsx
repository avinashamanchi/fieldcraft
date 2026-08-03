import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import type { PropsWithChildren } from 'react'
import { Text } from 'react-native'

import {
  AuthProvider,
  type AuthDataLifecycle,
  type AppStateLifecycle,
  useAuth,
} from '../src/auth/AuthProvider'
import {
  AuthOperationError,
  createAuthService,
  type AuthService,
  type AuthSession,
} from '../src/auth/authService'
import { SecureAuthStorageError } from '../src/auth/secureStoreAuthStorage'
import {
  createConfiguredSupabaseClient,
  SupabaseConfigurationError,
} from '../src/auth/supabase'
import LoginScreen from '../app/(auth)/login'
import SignupScreen from '../app/(auth)/signup'
import ResetPasswordScreen from '../app/(auth)/reset-password'
import OnboardingScreen, { type OnboardingProfile } from '../app/(auth)/onboarding'

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
  readonly listeners = new Set<(session: AuthSession | null) => void>()
  starts = 0
  stops = 0
  refreshRunning = false
  startGate: Promise<void> | null = null

  async getSession(): Promise<AuthSession | null> {
    if (this.sessionError) throw this.sessionError
    return this.session
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(session: AuthSession | null): void {
    this.session = session
    for (const listener of this.listeners) listener(session)
  }

  async startAutoRefresh(): Promise<void> {
    this.starts += 1
    await (this.startGate ?? Promise.resolve())
    this.refreshRunning = true
  }

  async stopAutoRefresh(): Promise<void> {
    this.stops += 1
    this.refreshRunning = false
  }

  async signIn(): Promise<void> {}
  async signUp(): Promise<{ verificationRequired: boolean }> {
    return { verificationRequired: true }
  }
  async requestPasswordReset(): Promise<void> {}
  async updatePassword(): Promise<void> {}
  async signOut(): Promise<void> {}
  async exchangeCode(): Promise<void> {}
  async verifySignup(): Promise<void> {}
  async recoverPassword(): Promise<void> {}
}

class FakeDataLifecycle implements AuthDataLifecycle {
  readonly calls: string[] = []
  readonly initializers = new Map<string, Promise<void>>()

  async initialize(ownerId: string): Promise<void> {
    this.calls.push(`initialize:${ownerId}`)
    await (this.initializers.get(ownerId) ?? Promise.resolve())
  }

  deactivateOwner(): void {
    this.calls.push('deactivate')
  }

  async clearOwner(ownerId: string): Promise<void> {
    this.calls.push(`clear:${ownerId}`)
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

const StateProbe = () => <Text testID="auth-state">{JSON.stringify(useAuth())}</Text>

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
  unmount()
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
  service.sessionError = new SecureAuthStorageError(new Error('provider-secret'))
  renderProvider(service)

  await waitFor(() =>
    expect(readState()).toEqual({
      status: 'storageError',
      message: 'Secure authentication storage is unavailable.',
    }),
  )
  expect(JSON.stringify(readState())).not.toContain('provider-secret')
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
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
      },
      clientFactory,
      storage,
    }),
  ).toBe(client)
  expect(clientFactory).toHaveBeenCalledWith(
    'https://project-ref.supabase.co',
    'publishable-key',
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

it('submits onboarding with only the approved bounded profile fields', async () => {
  const onComplete = jest.fn<Promise<void>, [OnboardingProfile]>(async () => undefined)
  render(<OnboardingScreen onComplete={onComplete} />)
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Avi Builder')
  fireEvent.changeText(screen.getByLabelText('Business name'), 'FieldCraft Plumbing')
  fireEvent.changeText(screen.getByLabelText('Trade'), 'Plumbing')
  fireEvent.changeText(screen.getByLabelText('Hourly rate'), '125.50')
  fireEvent.changeText(screen.getByLabelText('Tax percent'), '8.75')
  fireEvent.changeText(screen.getByLabelText('Payment terms'), 'Net 30')

  fireEvent.press(screen.getByRole('button', { name: 'Finish setup' }))

  await waitFor(() =>
    expect(onComplete).toHaveBeenCalledWith({
      name: 'Avi Builder',
      businessName: 'FieldCraft Plumbing',
      trade: 'Plumbing',
      rate: 125.5,
      tax: 8.75,
      paymentTerms: 'Net 30',
    }),
  )
  expect(Object.keys(onComplete.mock.calls[0][0])).toEqual([
    'name',
    'businessName',
    'trade',
    'rate',
    'tax',
    'paymentTerms',
  ])
})
