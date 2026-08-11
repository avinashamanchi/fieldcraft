import type { AuthenticatedOwnerLease } from '../auth/AuthProvider'
import { Linking } from 'react-native'
import {
  ownerLeasesEqual,
  type ProEntitlement,
  type RevenueCatClient,
  type SubscriptionPackage,
} from '../domain/monetization'

type CustomerInfoLike = unknown
type PackageLike = Readonly<{
  identifier?: unknown
  product?: Readonly<{
    identifier?: unknown
    priceString?: unknown
    subscriptionPeriod?: unknown
  }>
}>

export interface PurchasesPort {
  configure(configuration: { apiKey: string }): void
  logIn(appUserId: string): Promise<{ customerInfo: CustomerInfoLike }>
  logOut(): Promise<CustomerInfoLike>
  getCustomerInfo(): Promise<CustomerInfoLike>
  getOfferings(): Promise<unknown>
  purchasePackage(value: PackageLike): Promise<{ customerInfo: CustomerInfoLike }>
  restorePurchases(): Promise<CustomerInfoLike>
  addCustomerInfoUpdateListener(listener: (value: CustomerInfoLike) => void): void
  removeCustomerInfoUpdateListener(listener: (value: CustomerInfoLike) => void): boolean
}

type PurchasesModule = Readonly<{
  default?: PurchasesPort
}>

const loadNativePurchases = (): PurchasesPort => {
  // Keep the native module behind the port boundary. Expo Go never invokes this
  // loader, and non-native test runtimes can import the application root safely.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('react-native-purchases') as PurchasesModule | PurchasesPort
  return ('default' in loaded ? loaded.default : loaded) as PurchasesPort
}

export const createNativePurchasesPort = (): PurchasesPort => ({
  configure: (configuration) => loadNativePurchases().configure(configuration),
  logIn: (appUserId) => loadNativePurchases().logIn(appUserId),
  logOut: () => loadNativePurchases().logOut(),
  getCustomerInfo: () => loadNativePurchases().getCustomerInfo(),
  getOfferings: () => loadNativePurchases().getOfferings(),
  purchasePackage: (value) => loadNativePurchases().purchasePackage(value),
  restorePurchases: () => loadNativePurchases().restorePurchases(),
  addCustomerInfoUpdateListener: (listener) => (
    loadNativePurchases().addCustomerInfoUpdateListener(listener)
  ),
  removeCustomerInfoUpdateListener: (listener) => (
    loadNativePurchases().removeCustomerInfoUpdateListener(listener)
  ),
})

type Options = Readonly<{
  apiKey: string
  purchases: PurchasesPort
  isExpoGo: boolean
  openUrl?: (url: string) => Promise<void>
  now?: () => number
}>

const PRODUCTS = new Set(['fieldcraft_pro_monthly', 'fieldcraft_pro_annual'])

const record = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

const parseCustomerInfo = (value: CustomerInfoLike, now: number): ProEntitlement => {
  const root = record(value)
  const entitlements = record(root?.entitlements)
  const active = record(entitlements?.active)
  const pro = record(active?.pro)
  if (!pro) return { state: 'free' }
  const productId = pro.productIdentifier
  const expiresAt = pro.expirationDate
  if (
    typeof productId !== 'string' || !PRODUCTS.has(productId) ||
    typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
  ) return { state: 'unknown', reason: 'invalid-provider-entitlement' }
  if (Date.parse(expiresAt) <= now) return { state: 'free' }
  return {
    state: 'pro',
    productId: productId as 'fieldcraft_pro_monthly' | 'fieldcraft_pro_annual',
    expiresAt: new Date(Date.parse(expiresAt)).toISOString(),
  }
}

const errorCode = (error: unknown): string | null => {
  const value = record(error)
  if (typeof value?.code === 'string') return value.code
  return null
}

export const createRevenueCatClient = ({
  apiKey,
  purchases,
  isExpoGo,
  openUrl = async (url) => { await Linking.openURL(url) },
  now = Date.now,
}: Options): RevenueCatClient => {
  let configured = false
  let activeLease: AuthenticatedOwnerLease | null = null
  let lifecycleToken: symbol | null = null
  let providerListener: ((value: CustomerInfoLike) => void) | null = null
  let packages = new Map<string, PackageLike>()
  const subscribers = new Set<(value: ProEntitlement) => void>()

  const emit = (value: ProEntitlement) => {
    for (const listener of subscribers) listener(value)
  }

  const ensureConfigured = () => {
    if (configured) return
    if (!/^appl_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
      throw new Error('FieldCraft purchases are not configured for this build.')
    }
    purchases.configure({ apiKey })
    configured = true
  }

  const attachListener = (token: symbol) => {
    providerListener = (value) => {
      if (lifecycleToken !== token || activeLease === null) return
      emit(parseCustomerInfo(value, now()))
    }
    purchases.addCustomerInfoUpdateListener(providerListener)
  }

  const client: RevenueCatClient = {
    async start(lease) {
      if (isExpoGo) return { state: 'unknown', reason: 'development-build-required' }
      ensureConfigured()
      const token = Symbol('revenuecat-owner')
      activeLease = Object.freeze({ ...lease })
      lifecycleToken = token
      if (providerListener) purchases.removeCustomerInfoUpdateListener(providerListener)
      providerListener = null
      try {
        await purchases.logIn(lease.ownerId)
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          return { state: 'unknown', reason: 'stale-owner-lease' }
        }
        attachListener(token)
        const info = await purchases.getCustomerInfo()
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          return { state: 'unknown', reason: 'stale-owner-lease' }
        }
        return parseCustomerInfo(info, now())
      } catch {
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          return { state: 'unknown', reason: 'stale-owner-lease' }
        }
        return { state: 'unknown', reason: 'provider-unavailable' }
      }
    },

    async getPackages(): Promise<SubscriptionPackage[]> {
      if (isExpoGo) return []
      ensureConfigured()
      const offerings = record(await purchases.getOfferings())
      const current = record(offerings?.current)
      if (current?.identifier !== 'default' || !Array.isArray(current.availablePackages)) return []
      const next = new Map<string, PackageLike>()
      const mapped: SubscriptionPackage[] = []
      for (const candidate of current.availablePackages) {
        const item = record(candidate) as PackageLike | null
        const product = item ? record(item.product) : null
        if (
          !item || typeof item.identifier !== 'string' ||
          typeof product?.identifier !== 'string' || !PRODUCTS.has(product.identifier) ||
          typeof product.priceString !== 'string'
        ) continue
        const period = product.identifier === 'fieldcraft_pro_monthly' ? 'monthly' : 'annual'
        next.set(item.identifier, item)
        mapped.push({
          id: item.identifier,
          productId: product.identifier as SubscriptionPackage['productId'],
          price: product.priceString,
          period,
        })
      }
      packages = next
      return mapped.sort((left, right) => left.period === 'monthly' ? -1 : right.period === 'monthly' ? 1 : 0)
    },

    async purchase(packageId) {
      if (isExpoGo) throw new Error('Purchases require the FieldCraft development build.')
      const lease = activeLease
      const token = lifecycleToken
      if (!lease || !token) throw new Error('Sign in before purchasing FieldCraft Pro.')
      if (!packages.has(packageId)) await client.getPackages()
      if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
        throw new Error('The FieldCraft owner changed during purchase. Sign in again to verify it.')
      }
      const selected = packages.get(packageId)
      if (!selected) throw new Error('That FieldCraft subscription package is unavailable.')
      try {
        const result = await purchases.purchasePackage(selected)
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          throw new Error('The FieldCraft owner changed during purchase. Sign in again to verify it.')
        }
        parseCustomerInfo(result.customerInfo, now())
        return 'purchased'
      } catch (error) {
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          throw new Error('The FieldCraft owner changed during purchase. Sign in again to verify it.')
        }
        if (error instanceof Error && /owner changed/i.test(error.message)) throw error
        const code = errorCode(error)
        if (code === '1' || record(error)?.userCancelled === true) return 'cancelled'
        if (code === '20') return 'pending'
        throw new Error('The purchase could not be completed. Try again.')
      }
    },

    async restore() {
      if (isExpoGo) return { state: 'unknown', reason: 'development-build-required' }
      ensureConfigured()
      const lease = activeLease
      const token = lifecycleToken
      if (!lease || !token) return { state: 'unknown', reason: 'signed-out' }
      try {
        const value = parseCustomerInfo(await purchases.restorePurchases(), now())
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          return { state: 'unknown', reason: 'stale-owner-lease' }
        }
        return value
      } catch {
        if (lifecycleToken !== token || !ownerLeasesEqual(activeLease, lease)) {
          return { state: 'unknown', reason: 'stale-owner-lease' }
        }
        return { state: 'unknown', reason: 'provider-unavailable' }
      }
    },

    async openManageSubscriptions() {
      await openUrl('https://apps.apple.com/account/subscriptions')
    },

    async stop(lease) {
      if (isExpoGo || !ownerLeasesEqual(activeLease, lease)) return
      activeLease = null
      lifecycleToken = null
      if (providerListener) {
        purchases.removeCustomerInfoUpdateListener(providerListener)
        providerListener = null
      }
      try {
        await purchases.logOut()
      } catch {
        // The owner lease is already inert. A later start performs an explicit login.
      }
    },

    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
  }
  return client
}
