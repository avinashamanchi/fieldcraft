import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { AppState } from 'react-native'

import {
  useAuthenticatedOwnerLease,
  type AuthenticatedOwnerLease,
} from '../auth/AuthProvider'
import {
  ownerLeasesEqual,
  type ProEntitlement,
  type RevenueCatClient,
  type SubscriptionPackage,
} from '../domain/monetization'
import { EntitlementStore } from './entitlementStore'

export type ServerEntitlement =
  | { ownerId: string; state: 'free' }
  | {
      ownerId: string
      state: 'pro'
      productId: 'fieldcraft_pro_monthly' | 'fieldcraft_pro_annual'
      expiresAt: string
    }

export interface ServerEntitlementGateway {
  get(lease: AuthenticatedOwnerLease): Promise<ServerEntitlement>
}

const combineEntitlements = (
  lease: AuthenticatedOwnerLease,
  provider: ProEntitlement,
  server: ServerEntitlement,
): ProEntitlement => {
  if (server.ownerId !== lease.ownerId) {
    return { state: 'unknown', reason: 'stale-server-identity' }
  }
  if (provider.state === 'unknown') return provider
  if (provider.state === 'free' && server.state === 'free') return { state: 'free' }
  if (
    provider.state === 'pro' && server.state === 'pro' &&
    provider.productId === server.productId &&
    provider.expiresAt === server.expiresAt
  ) return provider
  return { state: 'unknown', reason: 'provider-server-mismatch' }
}

export class SubscriptionCoordinator {
  private desiredLease: AuthenticatedOwnerLease | null = null
  private activeLease: AuthenticatedOwnerLease | null = null
  private drainPromise: Promise<void> | null = null
  private stopBarrier: Promise<void> | null = null
  private providerEntitlement: ProEntitlement = { state: 'unknown', reason: 'verifying' }
  private verificationRevision = 0
  private readonly unsubscribeProvider: () => void

  constructor(
    private readonly client: RevenueCatClient,
    private readonly server: ServerEntitlementGateway,
    private readonly store: EntitlementStore,
  ) {
    this.unsubscribeProvider = client.subscribe((value) => {
      this.providerEntitlement = value
      const lease = this.activeLease
      if (lease && ownerLeasesEqual(lease, this.desiredLease)) {
        const revision = ++this.verificationRevision
        void this.verify(lease, value, revision)
      }
    })
  }

  transition(nextLease: AuthenticatedOwnerLease | null): Promise<void> {
    const next = nextLease ? Object.freeze({ ...nextLease }) : null
    const changed = !ownerLeasesEqual(this.desiredLease, next)
    if (changed) this.verificationRevision += 1
    this.desiredLease = next
    if (this.activeLease && !ownerLeasesEqual(this.activeLease, next)) {
      this.invalidateActive()
    }
    if (next) {
      if (!ownerLeasesEqual(this.store.getLease(), next)) this.store.bind(next)
    } else {
      this.store.invalidate('signed-out')
    }
    return this.ensureDrain()
  }

  invalidateBeforeTeardown(): void {
    this.verificationRevision += 1
    this.desiredLease = null
    this.store.invalidate('owner-invalidated')
    this.invalidateActive()
    void this.ensureDrain()
  }

  observeTime(): void {
    this.store.observeTime()
  }

  async refresh(): Promise<void> {
    const lease = this.activeLease
    if (!lease || !ownerLeasesEqual(lease, this.desiredLease)) return
    this.store.bind(lease)
    const revision = ++this.verificationRevision
    const provider = await this.client.start(lease)
    if (
      revision !== this.verificationRevision ||
      !ownerLeasesEqual(lease, this.activeLease) ||
      !ownerLeasesEqual(lease, this.desiredLease)
    ) return
    this.providerEntitlement = provider
    await this.verify(lease, provider, revision)
  }

  getPackages(): Promise<SubscriptionPackage[]> {
    return this.client.getPackages()
  }

  async purchase(packageId: string): Promise<'purchased' | 'cancelled' | 'pending'> {
    const lease = this.activeLease
    if (!lease || !ownerLeasesEqual(lease, this.desiredLease)) {
      throw new Error('Sign in before purchasing FieldCraft Pro.')
    }
    const outcome = await this.client.purchase(packageId)
    if (!ownerLeasesEqual(lease, this.activeLease) || !ownerLeasesEqual(lease, this.desiredLease)) {
      throw new Error('The FieldCraft owner changed during purchase. Sign in again to verify it.')
    }
    if (outcome === 'purchased') await this.refresh()
    return outcome
  }

  async restore(): Promise<ProEntitlement> {
    const lease = this.activeLease
    if (!lease || !ownerLeasesEqual(lease, this.desiredLease)) {
      return { state: 'unknown', reason: 'signed-out' }
    }
    this.store.bind(lease)
    const revision = ++this.verificationRevision
    const provider = await this.client.restore()
    if (
      revision !== this.verificationRevision ||
      !ownerLeasesEqual(lease, this.activeLease) ||
      !ownerLeasesEqual(lease, this.desiredLease)
    ) {
      return { state: 'unknown', reason: 'stale-owner-lease' }
    }
    this.providerEntitlement = provider
    await this.verify(lease, provider, revision)
    return this.store.get()
  }

  openManageSubscriptions(): Promise<void> {
    return this.client.openManageSubscriptions()
  }

  dispose(): void {
    this.invalidateBeforeTeardown()
    this.unsubscribeProvider()
  }

  private invalidateActive(): void {
    const active = this.activeLease
    if (!active) return
    this.activeLease = null
    const stopping = this.client.stop(active).then(() => undefined, () => undefined)
    this.stopBarrier = this.stopBarrier
      ? Promise.all([this.stopBarrier, stopping]).then(() => undefined)
      : stopping
  }

  private ensureDrain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise
    const running = this.drain()
    this.drainPromise = running.finally(() => {
      this.drainPromise = null
      if (!ownerLeasesEqual(this.activeLease, this.desiredLease)) void this.ensureDrain()
    })
    return this.drainPromise
  }

  private async drain(): Promise<void> {
    while (!ownerLeasesEqual(this.activeLease, this.desiredLease)) {
      if (this.stopBarrier) {
        const barrier = this.stopBarrier
        await barrier
        if (this.stopBarrier === barrier) this.stopBarrier = null
      }
      const target = this.desiredLease
      if (!target) return
      this.activeLease = target
      const revision = ++this.verificationRevision
      const provider = await this.client.start(target)
      if (
        revision !== this.verificationRevision ||
        !ownerLeasesEqual(this.activeLease, target) ||
        !ownerLeasesEqual(this.desiredLease, target)
      ) {
        continue
      }
      this.providerEntitlement = provider
      await this.verify(target, provider, revision)
    }
  }

  private async verify(
    lease: AuthenticatedOwnerLease,
    provider: ProEntitlement,
    revision: number,
  ): Promise<void> {
    try {
      const server = await this.server.get(lease)
      if (
        revision !== this.verificationRevision ||
        !ownerLeasesEqual(this.activeLease, lease) ||
        !ownerLeasesEqual(this.desiredLease, lease)
      ) return
      this.store.publish(lease, combineEntitlements(lease, provider, server))
    } catch {
      if (
        revision !== this.verificationRevision ||
        !ownerLeasesEqual(this.activeLease, lease) ||
        !ownerLeasesEqual(this.desiredLease, lease)
      ) return
      this.store.publish(lease, { state: 'unknown', reason: 'server-unavailable' })
    }
  }
}

type SubscriptionContextValue = Readonly<{
  entitlement: ProEntitlement
  packages: readonly SubscriptionPackage[]
  busy: boolean
  message: string | null
  loadPackages(): Promise<void>
  purchase(packageId: string): Promise<void>
  restore(): Promise<void>
  manage(): Promise<void>
}>

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null)

export const SubscriptionProvider = ({
  coordinator,
  store,
  children,
}: PropsWithChildren<{
  coordinator: SubscriptionCoordinator
  store: EntitlementStore
}>) => {
  const lease = useAuthenticatedOwnerLease()
  const entitlement = useSyncExternalStore(store.subscribe, store.get, store.get)
  const [packages, setPackages] = useState<readonly SubscriptionPackage[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void coordinator.transition(lease)
  }, [coordinator, lease])

  useEffect(() => {
    const timer = setInterval(() => coordinator.observeTime(), 30_000)
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void coordinator.refresh()
    })
    return () => {
      clearInterval(timer)
      appState.remove()
    }
  }, [coordinator])

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await operation()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The subscription action could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  const value = useMemo<SubscriptionContextValue>(() => ({
    entitlement,
    packages,
    busy,
    message,
    loadPackages: () => perform(async () => { setPackages(await coordinator.getPackages()) }),
    purchase: (packageId) => perform(async () => {
      const outcome = await coordinator.purchase(packageId)
      setMessage(outcome === 'cancelled'
        ? 'Purchase cancelled. Your plan is unchanged.'
        : outcome === 'pending'
          ? 'Purchase pending Apple approval. Pro remains locked until verified.'
          : 'Purchase received. FieldCraft is verifying Pro with the server.')
    }),
    restore: () => perform(async () => {
      const restored = await coordinator.restore()
      setMessage(restored.state === 'pro'
        ? 'FieldCraft Pro was restored and verified.'
        : 'No active verified FieldCraft Pro subscription was found.')
    }),
    manage: () => perform(() => coordinator.openManageSubscriptions()),
  }), [busy, coordinator, entitlement, message, packages])

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
}

export const useSubscription = (): SubscriptionContextValue => {
  const value = useContext(SubscriptionContext)
  if (!value) throw new Error('useSubscription must be used inside SubscriptionProvider')
  return value
}
