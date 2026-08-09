import type { AuthenticatedOwnerLease } from '../auth/AuthProvider'

export type Feature =
  | 'create-client'
  | 'create-open-job'
  | 'issue-document'
  | 'stripe-payment-link'
  | 'scheduled-reminder'
  | 'revenue-dashboard'
  | 'edit-existing-record'
  | 'record-payment'
  | 'export-account'
  | 'delete-account'

export type FeatureDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: 'FREE_LIMIT' | 'PRO_REQUIRED' | 'ENTITLEMENT_STALE'
      limit?: number
    }

export type ProEntitlement =
  | { state: 'unknown'; reason?: string }
  | { state: 'free' }
  | {
      state: 'pro'
      productId: 'fieldcraft_pro_monthly' | 'fieldcraft_pro_annual'
      expiresAt: string
    }

export type SubscriptionPackage = Readonly<{
  id: string
  productId: 'fieldcraft_pro_monthly' | 'fieldcraft_pro_annual'
  price: string
  period: 'monthly' | 'annual'
}>

export interface RevenueCatClient {
  start(lease: AuthenticatedOwnerLease): Promise<ProEntitlement>
  getPackages(): Promise<SubscriptionPackage[]>
  purchase(packageId: string): Promise<'purchased' | 'cancelled' | 'pending'>
  restore(): Promise<ProEntitlement>
  openManageSubscriptions(): Promise<void>
  stop(lease: AuthenticatedOwnerLease): Promise<void>
  subscribe(listener: (value: ProEntitlement) => void): () => void
}

export const FREE_LIMITS = {
  clients: 10,
  openJobs: 3,
  issuedDocumentsPerRolling30Days: 5,
} as const

export type FeatureCounts = Readonly<{
  clients: number
  openJobs: number
  issuedDocumentsPerRolling30Days: number
}>

const DOWNGRADE_SAFE = new Set<Feature>([
  'edit-existing-record',
  'record-payment',
  'export-account',
  'delete-account',
])
const PRO_ONLY = new Set<Feature>([
  'stripe-payment-link',
  'scheduled-reminder',
  'revenue-dashboard',
])

const boundedCount = (value: number): number => (
  Number.isSafeInteger(value) && value >= 0 ? value : Number.MAX_SAFE_INTEGER
)

export const evaluateFeature = (
  feature: Feature,
  entitlement: ProEntitlement,
  counts: FeatureCounts,
): FeatureDecision => {
  if (DOWNGRADE_SAFE.has(feature)) return { allowed: true }
  if (PRO_ONLY.has(feature)) {
    if (entitlement.state === 'pro') return { allowed: true }
    return entitlement.state === 'unknown'
      ? { allowed: false, reason: 'ENTITLEMENT_STALE' }
      : { allowed: false, reason: 'PRO_REQUIRED' }
  }

  const boundary = feature === 'create-client'
    ? { count: boundedCount(counts.clients), limit: FREE_LIMITS.clients }
    : feature === 'create-open-job'
      ? { count: boundedCount(counts.openJobs), limit: FREE_LIMITS.openJobs }
      : { count: boundedCount(counts.issuedDocumentsPerRolling30Days), limit: FREE_LIMITS.issuedDocumentsPerRolling30Days }
  if (boundary.count < boundary.limit) return { allowed: true }
  if (entitlement.state === 'pro') return { allowed: true }
  if (entitlement.state === 'unknown') {
    return { allowed: false, reason: 'ENTITLEMENT_STALE' }
  }
  return { allowed: false, reason: 'FREE_LIMIT', limit: boundary.limit }
}

export const ownerLeasesEqual = (
  left: AuthenticatedOwnerLease | null,
  right: AuthenticatedOwnerLease | null,
): boolean => left === right || (
  left !== null &&
  right !== null &&
  left.ownerId === right.ownerId &&
  left.sessionGeneration === right.sessionGeneration &&
  left.repositoryRevision === right.repositoryRevision
)
