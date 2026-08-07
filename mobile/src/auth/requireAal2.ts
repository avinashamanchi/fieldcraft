import type { AuthenticatedOwnerLease } from './AuthProvider'

export type SensitiveOperation =
  | 'stripe-connect'
  | 'payment-link'
  | 'payment-adjustment'
  | 'account-export'
  | 'disable-mfa'
  | 'delete-account'

export class StepUpRequiredError extends Error {
  readonly code = 'STEP_UP_REQUIRED'

  constructor(readonly operation: SensitiveOperation) {
    super('Please verify with your authenticator before continuing.')
    this.name = 'StepUpRequiredError'
  }
}

export type Aal2Verification = AuthenticatedOwnerLease & { verifiedAt: number }

export interface RecentAal2Guard {
  updateLease(lease: AuthenticatedOwnerLease | null): void
  markVerified(verification: Aal2Verification): void
  requireRecentAal2(operation: SensitiveOperation, now?: number): AuthenticatedOwnerLease
  clear(): void
}

const FIFTEEN_MINUTES_MS = 15 * 60_000

const sameLease = (
  left: AuthenticatedOwnerLease | null,
  right: AuthenticatedOwnerLease | null,
): boolean => Boolean(
  left && right &&
  left.ownerId === right.ownerId &&
  left.sessionGeneration === right.sessionGeneration &&
  left.repositoryRevision === right.repositoryRevision,
)

export const createRecentAal2Guard = (): RecentAal2Guard => {
  let currentLease: AuthenticatedOwnerLease | null = null
  let verified: Aal2Verification | null = null

  return {
    updateLease(nextLease) {
      if (!sameLease(currentLease, nextLease)) verified = null
      currentLease = nextLease
    },
    markVerified(nextVerification) {
      if (!sameLease(currentLease, nextVerification)) {
        throw new StepUpRequiredError('disable-mfa')
      }
      if (!Number.isFinite(nextVerification.verifiedAt) || nextVerification.verifiedAt < 0) {
        throw new Error('AAL2 verification time is invalid')
      }
      verified = Object.freeze({ ...nextVerification })
    },
    requireRecentAal2(operation, now = Date.now()) {
      if (
        !currentLease ||
        !verified ||
        !sameLease(currentLease, verified) ||
        now < verified.verifiedAt ||
        now - verified.verifiedAt > FIFTEEN_MINUTES_MS
      ) {
        throw new StepUpRequiredError(operation)
      }
      return currentLease
    },
    clear() {
      verified = null
    },
  }
}

const recentAal2Guard = createRecentAal2Guard()

export const getRecentAal2Guard = (): RecentAal2Guard => recentAal2Guard

export const requireRecentAal2 = (
  operation: SensitiveOperation,
  now = Date.now(),
): AuthenticatedOwnerLease => recentAal2Guard.requireRecentAal2(operation, now)
