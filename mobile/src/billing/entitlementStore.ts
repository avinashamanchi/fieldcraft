import type { AuthenticatedOwnerLease } from '../auth/AuthProvider'
import {
  ownerLeasesEqual,
  type ProEntitlement,
} from '../domain/monetization'

export class EntitlementStore {
  private lease: AuthenticatedOwnerLease | null = null
  private value: ProEntitlement = { state: 'unknown', reason: 'signed-out' }
  private readonly listeners = new Set<() => void>()

  constructor(private readonly now: () => number = Date.now) {}

  get = (): ProEntitlement => this.value

  getLease = (): AuthenticatedOwnerLease | null => this.lease

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bind(lease: AuthenticatedOwnerLease): void {
    this.lease = Object.freeze({ ...lease })
    this.setValue({ state: 'unknown', reason: 'verifying' })
  }

  invalidate(reason = 'signed-out'): void {
    this.lease = null
    this.setValue({ state: 'unknown', reason })
  }

  publish(lease: AuthenticatedOwnerLease, value: ProEntitlement): boolean {
    if (!ownerLeasesEqual(this.lease, lease)) return false
    this.setValue(this.normalize(value))
    return true
  }

  observeTime(): void {
    const normalized = this.normalize(this.value)
    if (normalized.state !== this.value.state || (
      normalized.state === 'unknown' && this.value.state === 'unknown' &&
      normalized.reason !== this.value.reason
    )) this.setValue(normalized)
  }

  private normalize(value: ProEntitlement): ProEntitlement {
    if (value.state !== 'pro') return value
    const expiration = Date.parse(value.expiresAt)
    if (!Number.isFinite(expiration) || expiration <= this.now()) return { state: 'free' }
    return value
  }

  private setValue(next: ProEntitlement): void {
    if (JSON.stringify(this.value) === JSON.stringify(next)) return
    this.value = Object.freeze({ ...next }) as ProEntitlement
    for (const listener of this.listeners) listener()
  }
}
