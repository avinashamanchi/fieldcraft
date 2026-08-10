import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { Linking } from 'react-native'
import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import SubscriptionScreen from '../app/subscription'
import {
  SubscriptionCoordinator,
  SubscriptionProvider,
  type ServerEntitlementGateway,
} from '../src/billing/SubscriptionProvider'
import { EntitlementStore } from '../src/billing/entitlementStore'
import type { ProEntitlement, RevenueCatClient } from '../src/domain/monetization'

const mockRouterPush = jest.fn()
let mockSubscriptionLease: AuthenticatedOwnerLease | null = Object.freeze({
  ownerId: '70000000-0000-4000-8000-000000000001',
  sessionGeneration: 1,
  repositoryRevision: 1,
})

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
}))
jest.mock('../src/auth/AuthProvider', () => ({
  useAuthenticatedOwnerLease: () => mockSubscriptionLease,
}))

const lease = (ownerId: string, sessionGeneration = 1, repositoryRevision = 1): AuthenticatedOwnerLease => Object.freeze({
  ownerId,
  sessionGeneration,
  repositoryRevision,
})
const providerPro: ProEntitlement = {
  state: 'pro',
  productId: 'fieldcraft_pro_monthly',
  expiresAt: '2026-09-01T00:00:00.000Z',
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const client = (overrides: Partial<RevenueCatClient> = {}): RevenueCatClient => ({
  start: async () => providerPro,
  getPackages: async () => [],
  purchase: async () => 'purchased',
  restore: async () => providerPro,
  openManageSubscriptions: async () => {},
  stop: async () => {},
  subscribe: () => () => {},
  ...overrides,
})

const server = (overrides: Partial<ServerEntitlementGateway> = {}): ServerEntitlementGateway => ({
  get: async (expectedLease) => ({
    ownerId: expectedLease.ownerId,
    state: 'pro',
    productId: 'fieldcraft_pro_monthly',
    expiresAt: '2026-09-01T00:00:00.000Z',
  }),
  ...overrides,
})

describe('SubscriptionCoordinator', () => {
  it('unlocks only when provider and server agree and expires by the local timer boundary', async () => {
    let now = Date.parse('2026-08-09T00:00:00.000Z')
    const store = new EntitlementStore(() => now)
    const coordinator = new SubscriptionCoordinator(client(), server(), store)
    const owner = lease('70000000-0000-4000-8000-000000000001')
    await coordinator.transition(owner)
    expect(store.get()).toMatchObject({ state: 'pro' })
    now = Date.parse('2026-09-01T00:00:00.000Z')
    coordinator.observeTime()
    expect(store.get()).toEqual({ state: 'free' })
  })

  it('returns unknown for provider/server disagreement or stale server identity', async () => {
    const owner = lease('70000000-0000-4000-8000-000000000001')
    const mismatchedServer = server({
      get: async () => ({
        ownerId: owner.ownerId,
        state: 'free',
      }),
    })
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    await new SubscriptionCoordinator(client(), mismatchedServer, store).transition(owner)
    expect(store.get()).toEqual({ state: 'unknown', reason: 'provider-server-mismatch' })
  })

  it('invalidates the old lease before stop, serializes owners, and ignores every late start result', async () => {
    const firstStart = deferred<ProEntitlement>()
    const events: string[] = []
    const billing = client({
      start: async (value) => {
        events.push(`start:${value.ownerId}`)
        if (value.ownerId.endsWith('1')) return firstStart.promise
        return providerPro
      },
      stop: async (value) => { events.push(`stop:${value.ownerId}`) },
    })
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    const coordinator = new SubscriptionCoordinator(billing, server(), store)
    const ownerA = lease('70000000-0000-4000-8000-000000000001')
    const ownerB = lease('70000000-0000-4000-8000-000000000002', 2, 2)
    const first = coordinator.transition(ownerA)
    const second = coordinator.transition(ownerB)
    expect(store.get()).toEqual({ state: 'unknown', reason: 'verifying' })
    firstStart.resolve(providerPro)
    await Promise.all([first, second])
    expect(events).toEqual([
      `start:${ownerA.ownerId}`,
      `stop:${ownerA.ownerId}`,
      `start:${ownerB.ownerId}`,
    ])
    expect(store.get()).toMatchObject({ state: 'pro' })
  })

  it('does not reset a verified entitlement for an equivalent immutable lease', async () => {
    let serverCalls = 0
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    const coordinator = new SubscriptionCoordinator(client(), server({
      get: async (value) => {
        serverCalls += 1
        return {
          ownerId: value.ownerId,
          state: 'pro',
          productId: 'fieldcraft_pro_monthly',
          expiresAt: '2026-09-01T00:00:00.000Z',
        }
      },
    }), store)
    const owner = lease('70000000-0000-4000-8000-000000000001', 2, 3)
    await coordinator.transition(owner)
    await coordinator.transition(Object.freeze({ ...owner }))

    expect(store.get()).toMatchObject({ state: 'pro' })
    expect(serverCalls).toBe(1)
  })

  it('does not let an older same-owner verification overwrite a newer provider result', async () => {
    const firstServer = deferred<Awaited<ReturnType<ServerEntitlementGateway['get']>>>()
    const providerEvents: { emit?: (value: ProEntitlement) => void } = {}
    let serverCalls = 0
    const billing = client({
      subscribe: (listener) => {
        providerEvents.emit = listener
        return () => { delete providerEvents.emit }
      },
    })
    const gateway = server({
      get: async (value) => {
        serverCalls += 1
        if (serverCalls === 1) return firstServer.promise
        return { ownerId: value.ownerId, state: 'free' }
      },
    })
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    const coordinator = new SubscriptionCoordinator(billing, gateway, store)
    const owner = lease('70000000-0000-4000-8000-000000000001')
    const initial = coordinator.transition(owner)
    await Promise.resolve()
    providerEvents.emit?.({ state: 'free' })
    await Promise.resolve()
    await Promise.resolve()
    expect(store.get()).toEqual({ state: 'free' })

    firstServer.resolve({
      ownerId: owner.ownerId,
      state: 'pro',
      productId: 'fieldcraft_pro_monthly',
      expiresAt: '2026-09-01T00:00:00.000Z',
    })
    await initial
    expect(store.get()).toEqual({ state: 'free' })
  })
})

describe('SubscriptionScreen', () => {
  beforeEach(() => {
    mockRouterPush.mockReset()
    mockSubscriptionLease = lease('70000000-0000-4000-8000-000000000001')
  })

  it('renders StoreKit prices, renewal terms, and working purchase controls', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const purchase = jest.fn(async () => 'cancelled' as const)
    const restore = jest.fn(async () => providerPro)
    const manage = jest.fn(async () => {})
    const billing = client({
      getPackages: async () => [
        { id: '$rc_monthly', productId: 'fieldcraft_pro_monthly', period: 'monthly', price: '$8.99' },
        { id: '$rc_annual', productId: 'fieldcraft_pro_annual', period: 'annual', price: '$79.99' },
      ],
      purchase,
      restore,
      openManageSubscriptions: manage,
    })
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    const coordinator = new SubscriptionCoordinator(billing, server(), store)
    render(
      <SubscriptionProvider coordinator={coordinator} store={store}>
        <SubscriptionScreen />
      </SubscriptionProvider>,
    )

    expect(await screen.findByText('Monthly · $8.99')).toBeTruthy()
    expect(screen.getByText('Annual · $79.99')).toBeTruthy()
    expect(screen.getByText(/renews automatically/i)).toBeTruthy()
    fireEvent.press(screen.getByText('Monthly · $8.99'))
    await waitFor(() => expect(purchase).toHaveBeenCalledWith('$rc_monthly'))
    expect(await screen.findByText(/Purchase cancelled/i)).toBeTruthy()
    fireEvent.press(screen.getByText('Restore purchases'))
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1))
    fireEvent.press(screen.getByText('Manage subscription with Apple'))
    await waitFor(() => expect(manage).toHaveBeenCalledTimes(1))
    fireEvent.press(screen.getByText('Privacy Policy'))
    fireEvent.press(screen.getByText('Terms of Use'))
    expect(openURL).toHaveBeenNthCalledWith(1, 'https://avinashamanchi.github.io/fieldcraft/privacy.html')
    expect(openURL).toHaveBeenNthCalledWith(2, 'https://avinashamanchi.github.io/fieldcraft/terms.html')
    openURL.mockRestore()
  })

  it('explains that Expo Go cannot purchase or grant Pro', async () => {
    const billing = client({
      start: async () => ({ state: 'unknown', reason: 'development-build-required' }),
      getPackages: async () => [],
    })
    const store = new EntitlementStore(() => Date.parse('2026-08-09T00:00:00.000Z'))
    const coordinator = new SubscriptionCoordinator(billing, server(), store)
    render(
      <SubscriptionProvider coordinator={coordinator} store={store}>
        <SubscriptionScreen />
      </SubscriptionProvider>,
    )

    expect(await screen.findByText(/Expo Go cannot buy or grant Pro/i)).toBeTruthy()
    expect(screen.queryByText(/Monthly ·/i)).toBeNull()
  })
})
