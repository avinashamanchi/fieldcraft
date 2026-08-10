import { render, screen, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import RootLayout, { ProductRouteBoundary } from '../app/_layout'
import appConfig from '../app.config'
import { colors } from '../src/theme/tokens'

const easConfig = require('../eas.json')
const { stripDevelopmentNetworkKeys } = require('../plugins/withReleaseNetworkPolicy.cjs') as {
  stripDevelopmentNetworkKeys: (value: Record<string, unknown>) => Record<string, unknown>
}

let mockAuthState: { status: string; userId?: string; email?: string; hydrated?: boolean; message?: string } = { status: 'signedOut' }
let mockSegments: string[] = ['(tabs)']
let mockLease: { ownerId: string; sessionGeneration: number; repositoryRevision: number } | null = null
let mockRepositoryOwnerId: string | null = null
const mockRouterReplace = jest.fn()
const mockRepository = {
  get: jest.fn(async () => null),
  list: jest.fn(async () => []),
  transactLocalMutation: jest.fn(async () => {}),
}
let observedAuthProviderProps: Record<string, unknown> = {}
let observedSyncProviderProps: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
  Stack: () => null,
  useSegments: () => mockSegments,
}))
jest.mock('../src/auth/AuthProvider', () => ({
  AuthProvider: ({ children, ...props }: { children: ReactNode } & Record<string, unknown>) => {
    observedAuthProviderProps = props
    return children
  },
  useAuth: () => mockAuthState,
  useAuthenticatedOwnerLease: () => mockLease,
}))
jest.mock('../src/data/DataProvider', () => ({
  DataProvider: ({ children }: { children: ReactNode }) => children,
  useFieldCraftData: () => ({
    owner: { ownerId: mockRepositoryOwnerId },
    repository: mockRepository,
  }),
}))

beforeEach(() => {
  mockAuthState = { status: 'signedOut' }
  mockSegments = ['(tabs)']
  mockLease = null
  mockRepositoryOwnerId = null
  mockRouterReplace.mockReset()
})
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
  expect(config.ios?.usesAppleSignIn).toBe(false)
  expect(config.ios?.supportsTablet).toBe(false)
  expect(config.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false)
  expect(config.updates).toEqual({ enabled: false })
  expect(config.plugins).toContain('./plugins/withReleaseNetworkPolicy.cjs')
  expect(config.extra).toMatchObject({
    privacyPolicyUrl: 'https://avinashamanchi.github.io/fieldcraft/privacy.html',
    supportUrl: 'https://avinashamanchi.github.io/fieldcraft/support.html',
    termsOfUseUrl: 'https://avinashamanchi.github.io/fieldcraft/terms.html',
  })
})

it('enforces HTTPS-only transport and removes development discovery from release plists', () => {
  expect(stripDevelopmentNetworkKeys({
    NSBonjourServices: ['_expo._tcp'],
    NSLocalNetworkUsageDescription: 'Development server discovery',
    NSAppTransportSecurity: {
      NSAllowsArbitraryLoads: true,
      NSAllowsArbitraryLoadsForMedia: true,
      NSAllowsArbitraryLoadsInWebContent: true,
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true } },
    },
  })).toEqual({
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
  })
})

it('uses remote build-number auto-increment without submission credentials', () => {
  expect(easConfig.cli).toMatchObject({ appVersionSource: 'remote', requireCommit: true })
  expect(easConfig.build.production).toEqual({
    distribution: 'store',
    autoIncrement: true,
    ios: { image: 'auto' },
  })
  expect(easConfig).not.toHaveProperty('submit')
  expect(JSON.stringify(easConfig)).not.toMatch(/appleId|ascApiKey|password/i)
})

it('mounts the native root', () => {
  mockAuthState = { status: 'signedOut' }
  render(<RootLayout />)
  expect(screen.queryByText(/vite/i)).toBeNull()
})

const productRouteFamilies = [
  ['tabs', ['(tabs)', 'index']],
  ['jobs', ['jobs', '[id]']],
  ['invoices', ['invoices', '[id]']],
  ['settings', ['settings', 'sync']],
  ['security', ['security', 'mfa']],
] as const

it.each(productRouteFamilies)(
  'redirects signed-out %s deep links without rendering product children',
  async (_family, segments) => {
    mockSegments = [...segments]
    render(<ProductRouteBoundary><Text>Protected product</Text></ProductRouteBoundary>)

    expect(screen.queryByText('Protected product')).toBeNull()
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/login'))
  },
)

it.each(productRouteFamilies)(
  'redirects verification-required %s deep links without rendering product children',
  async (_family, segments) => {
    mockSegments = [...segments]
    mockAuthState = { status: 'verificationRequired', email: 'person@example.com' }
    render(<ProductRouteBoundary><Text>Protected product</Text></ProductRouteBoundary>)

    expect(screen.queryByText('Protected product')).toBeNull()
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/verify-email'))
  },
)

const blockedIdentityStates = [
  ['initializing', { status: 'initializing' }, null, null],
  ['hydrating', { status: 'signedIn', userId: 'owner-a', email: 'a@example.com', hydrated: false }, null, null],
  ['missing lease', { status: 'signedIn', userId: 'owner-a', email: 'a@example.com', hydrated: true }, null, 'owner-a'],
  ['repository owner mismatch', { status: 'signedIn', userId: 'owner-a', email: 'a@example.com', hydrated: true }, { ownerId: 'owner-a', sessionGeneration: 1, repositoryRevision: 1 }, 'owner-b'],
  ['lease owner mismatch', { status: 'signedIn', userId: 'owner-a', email: 'a@example.com', hydrated: true }, { ownerId: 'owner-b', sessionGeneration: 1, repositoryRevision: 1 }, 'owner-b'],
] as const

const blockedProductCases = productRouteFamilies.flatMap(([family, segments]) =>
  blockedIdentityStates.map(([state, authState, lease, repositoryOwnerId]) => [
    `${family} / ${state}`,
    segments,
    authState,
    lease,
    repositoryOwnerId,
  ] as const),
)

it.each(blockedProductCases)(
  'does not admit product children while route identity is %s',
  (_label, segments, authState, lease, repositoryOwnerId) => {
    mockSegments = [...segments]
    mockAuthState = authState
    mockLease = lease
    mockRepositoryOwnerId = repositoryOwnerId

    render(<ProductRouteBoundary><Text>Protected product</Text></ProductRouteBoundary>)

    expect(screen.queryByText('Protected product')).toBeNull()
    expect(mockRouterReplace).not.toHaveBeenCalled()
  },
)

it.each(productRouteFamilies)(
  'admits hydrated %s routes only under the current owner lease',
  (_family, segments) => {
    mockSegments = [...segments]
    mockAuthState = { status: 'signedIn', userId: 'owner-a', email: 'a@example.com', hydrated: true }
    mockLease = Object.freeze({ ownerId: 'owner-a', sessionGeneration: 2, repositoryRevision: 3 })
    mockRepositoryOwnerId = 'owner-a'
    render(<ProductRouteBoundary><Text>Hydrated product</Text></ProductRouteBoundary>)
    expect(screen.getByText('Hydrated product')).toBeTruthy()
  },
)

it.each([
  ['login', ['(auth)', 'login']],
  ['signup', ['(auth)', 'signup']],
  ['reset password', ['(auth)', 'reset-password']],
  ['verify email', ['(auth)', 'verify-email']],
  ['privacy', ['privacy']],
] as const)('renders the intended public %s route', (_label, segments) => {
  mockSegments = [...segments]
  render(<ProductRouteBoundary><Text>Public route</Text></ProductRouteBoundary>)
  expect(screen.getByText('Public route')).toBeTruthy()
})

it('requires identity before rendering secure onboarding', async () => {
  mockSegments = ['(auth)', 'onboarding']
  render(<ProductRouteBoundary><Text>Secure onboarding</Text></ProductRouteBoundary>)
  expect(screen.queryByText('Secure onboarding')).toBeNull()
  await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/login'))

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
