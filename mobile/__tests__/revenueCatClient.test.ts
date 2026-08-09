import type { AuthenticatedOwnerLease } from '../src/auth/AuthProvider'
import {
  createRevenueCatClient,
  type PurchasesPort,
} from '../src/billing/revenueCatClient'
import type { ProEntitlement } from '../src/domain/monetization'

const ownerA: AuthenticatedOwnerLease = Object.freeze({
  ownerId: '70000000-0000-4000-8000-000000000001',
  sessionGeneration: 3,
  repositoryRevision: 5,
})
const ownerB: AuthenticatedOwnerLease = Object.freeze({
  ownerId: '70000000-0000-4000-8000-000000000002',
  sessionGeneration: 4,
  repositoryRevision: 6,
})

const customerInfo = (active = true, expirationDate = '2026-09-01T00:00:00.000Z') => ({
  entitlements: {
    active: active ? {
      pro: {
        identifier: 'pro',
        productIdentifier: 'fieldcraft_pro_monthly',
        expirationDate,
        willRenew: true,
        billingIssueDetectedAt: null,
        unsubscribeDetectedAt: null,
      },
    } : {},
  },
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const makePort = (): PurchasesPort & { calls: string[]; emit(value: unknown): void } => {
  const calls: string[] = []
  let listener: ((value: unknown) => void) | null = null
  return {
    calls,
    configure: () => { calls.push('configure') },
    logIn: async () => { calls.push('login'); return { customerInfo: customerInfo() } },
    logOut: async () => { calls.push('logout'); return customerInfo(false) },
    getCustomerInfo: async () => { calls.push('customer-info'); return customerInfo() },
    getOfferings: async () => ({
      current: {
        identifier: 'default',
        availablePackages: [
          { identifier: '$rc_monthly', product: { identifier: 'fieldcraft_pro_monthly', priceString: '$8.99', subscriptionPeriod: 'P1M' } },
          { identifier: '$rc_annual', product: { identifier: 'fieldcraft_pro_annual', priceString: '$79.99', subscriptionPeriod: 'P1Y' } },
        ],
      },
    }),
    purchasePackage: async () => ({ customerInfo: customerInfo() }),
    restorePurchases: async () => customerInfo(),
    addCustomerInfoUpdateListener: (next) => { calls.push('listen'); listener = next },
    removeCustomerInfoUpdateListener: (next) => {
      calls.push('unlisten')
      if (listener === next) listener = null
      return true
    },
    emit: (value) => listener?.(value),
  }
}

describe('RevenueCat owner lifecycle', () => {
  it('configures before owner login, maps exact packages, and logs out only the matching lease', async () => {
    const purchases = makePort()
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })

    await expect(client.start(ownerA)).resolves.toMatchObject({ state: 'pro', productId: 'fieldcraft_pro_monthly' })
    expect(purchases.calls.slice(0, 4)).toEqual(['configure', 'login', 'listen', 'customer-info'])
    await expect(client.getPackages()).resolves.toEqual([
      { id: '$rc_monthly', productId: 'fieldcraft_pro_monthly', price: '$8.99', period: 'monthly' },
      { id: '$rc_annual', productId: 'fieldcraft_pro_annual', price: '$79.99', period: 'annual' },
    ])
    await client.stop(ownerB)
    expect(purchases.calls).not.toContain('logout')
    await client.stop(ownerA)
    expect(purchases.calls.slice(-2)).toEqual(['unlisten', 'logout'])
  })

  it('discards late provider callbacks after stop and maps cancellation and pending distinctly', async () => {
    const purchases = makePort()
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })
    const seen: string[] = []
    client.subscribe((value) => seen.push(value.state))
    await client.start(ownerA)
    await client.stop(ownerA)
    purchases.emit(customerInfo())
    expect(seen).toEqual([])

    purchases.purchasePackage = async () => { throw { code: '1', userCancelled: true } }
    await expect(client.start(ownerA)).resolves.toBeDefined()
    await expect(client.purchase('$rc_monthly')).resolves.toBe('cancelled')
    purchases.purchasePackage = async () => { throw { code: '20' } }
    await expect(client.purchase('$rc_monthly')).resolves.toBe('pending')
  })

  it('never configures, purchases, or grants Pro in Expo Go', async () => {
    const purchases = makePort()
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: true,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })
    await expect(client.start(ownerA)).resolves.toEqual({ state: 'unknown', reason: 'development-build-required' })
    await expect(client.purchase('$rc_monthly')).rejects.toThrow('development build')
    expect(purchases.calls).toEqual([])
  })

  it('opens Apple subscription management without calling a nonexistent SDK method', async () => {
    const purchases = makePort()
    const opened: string[] = []
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      openUrl: async (url) => { opened.push(url) },
    })
    await client.start(ownerA)
    await client.openManageSubscriptions()
    expect(opened).toEqual(['https://apps.apple.com/account/subscriptions'])
  })

  it('ignores a start result after its full owner lease is superseded', async () => {
    const purchases = makePort()
    const blocked = deferred<{ customerInfo: ReturnType<typeof customerInfo> }>()
    purchases.logIn = async () => blocked.promise
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })
    const first = client.start(ownerA)
    const stop = client.stop(ownerA)
    blocked.resolve({ customerInfo: customerInfo() })
    await stop
    await expect(first).resolves.toMatchObject({ state: 'unknown' })
    expect(purchases.calls).not.toContain('customer-info')
  })

  it('does not publish a purchase result after its owner lease changes', async () => {
    const purchases = makePort()
    const blocked = deferred<{ customerInfo: ReturnType<typeof customerInfo> }>()
    purchases.purchasePackage = async () => blocked.promise
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })
    const seen: ProEntitlement['state'][] = []
    client.subscribe((value) => seen.push(value.state))
    await client.start(ownerA)
    await client.getPackages()
    const purchase = client.purchase('$rc_monthly')
    await client.stop(ownerA)
    await client.start(ownerB)
    blocked.resolve({ customerInfo: customerInfo() })

    await expect(purchase).rejects.toThrow(/owner changed/i)
    expect(seen).toEqual([])
  })

  it('does not publish a restore result after its owner lease changes', async () => {
    const purchases = makePort()
    const blocked = deferred<ReturnType<typeof customerInfo>>()
    purchases.restorePurchases = async () => blocked.promise
    const client = createRevenueCatClient({
      apiKey: 'appl_public_fieldcraft_test_key',
      purchases,
      isExpoGo: false,
      now: () => Date.parse('2026-08-09T00:00:00.000Z'),
    })
    const seen: ProEntitlement['state'][] = []
    client.subscribe((value) => seen.push(value.state))
    await client.start(ownerA)
    const restore = client.restore()
    await client.stop(ownerA)
    await client.start(ownerB)
    blocked.resolve(customerInfo())

    await expect(restore).resolves.toEqual({ state: 'unknown', reason: 'stale-owner-lease' })
    expect(seen).toEqual([])
  })
})
