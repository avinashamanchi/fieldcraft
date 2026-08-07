import { render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import RootLayout from '../app/_layout'
import appConfig from '../app.config'
import { colors } from '../src/theme/tokens'

let mockAuthState: { status: string; userId?: string; hydrated?: boolean; message?: string } = { status: 'signedOut' }
const mockRepository = { list: jest.fn(async () => []), transactLocalMutation: jest.fn(async () => {}) }
let observedAuthProviderProps: Record<string, unknown> = {}
let observedSyncProviderProps: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  Stack: () => null,
  useSegments: () => ['(tabs)'],
}))
jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    observedAuthProviderProps = props
    return children
  },
  useAuth: () => mockAuthState,
  useAuthenticatedOwnerLease: () => mockAuthState.status === 'signedIn' && mockAuthState.userId
    ? Object.freeze({ ownerId: mockAuthState.userId, sessionGeneration: 1, repositoryRevision: 1 })
    : null,
}))
jest.mock('../src/data/DataProvider', () => ({
  DataProvider: ({ children }: { children: ReactNode }) => children,
  useFieldCraftData: () => ({
    owner: { ownerId: mockAuthState.userId ?? null },
    repository: mockRepository,
  }),
}))
jest.mock('../src/data/SyncProvider', () => ({
  SyncProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    observedSyncProviderProps = props
    return children
  },
}))
jest.mock('../src/data/sqliteRepository', () => ({
  SQLiteFieldCraftRepository: class SQLiteFieldCraftRepository {},
}))
jest.mock('../src/features/onboarding/OnboardingGate', () => ({
  OnboardingGate: ({ children }: { children: ReactNode }) => children,
}))

it('uses the exact FieldCraft iOS identity', () => {
  const config = appConfig({ config: {} } as never)
  expect(config.name).toBe('FieldCraft')
  expect(config.scheme).toBe('fieldcraft')
  expect(config.ios?.bundleIdentifier).toBe('com.avinashamanchi.fieldcraft')
  expect(config.ios?.buildNumber).toBe('1')
})

it('mounts the native root', () => {
  mockAuthState = { status: 'signedOut' }
  render(<RootLayout />)
  expect(screen.queryByText(/vite/i)).toBeNull()
})

it('keeps the application tree hidden while first cloud hydration is incomplete', () => {
  mockAuthState = { status: 'signedIn', userId: 'owner-a', hydrated: false }
  render(<RootLayout />)

  expect(screen.getByText('Preparing your secure workspace…')).toBeTruthy()
})

it('renders the startup status legibly on the dark FieldCraft surface', () => {
  mockAuthState = { status: 'initializing' }
  render(<RootLayout />)

  expect(screen.getByLabelText('Preparing FieldCraft data')).toHaveStyle({
    backgroundColor: colors.charcoal,
  })
  expect(screen.getByText('Preparing your secure workspace…')).toHaveStyle({
    color: colors.warmWhite,
  })
})

it('renders local startup failures as visible alerts', () => {
  mockAuthState = { status: 'storageError', message: 'Local data could not be prepared securely.' }
  render(<RootLayout />)

  expect(screen.getByRole('alert')).toHaveStyle({ color: colors.danger })
})

it('never enables synthetic authentication or offline-only sync from an environment flag', () => {
  process.env.EXPO_PUBLIC_FIELDCRAFT_DEMO_MODE = 'true'
  mockAuthState = {
    status: 'signedIn',
    userId: '123e4567-e89b-12d3-a456-426614174000',
    hydrated: true,
  }

  try {
    render(<RootLayout />)
  } finally {
    delete process.env.EXPO_PUBLIC_FIELDCRAFT_DEMO_MODE
  }

  expect(observedAuthProviderProps.service).toBeUndefined()
  expect(observedAuthProviderProps.refreshLifecycleEnabled).toBeUndefined()
  expect(observedSyncProviderProps.coordinator).toBeUndefined()
  expect(observedSyncProviderProps.lifecycle).toBeUndefined()
})
