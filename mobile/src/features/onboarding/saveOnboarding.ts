import { z } from 'zod'

import { isCanonicalOwnerId } from '../../auth/authService'
import type { AuthenticatedOwnerLease } from '../../auth/AuthProvider'
import type { OnboardingProfileV1, UserProfile } from '../../domain/entities'
import type { MutationEnvelope } from '../../domain/sync'

const CanonicalUuidSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
)
const TimestampSchema = z.string().refine((value) => {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}, 'timestamp must be canonical UTC ISO-8601')

const OnboardingProfileSchema: z.ZodType<OnboardingProfileV1> = z.object({
  displayName: z.string().trim().min(1).max(100),
  businessName: z.string().trim().min(1).max(120),
  tradeType: z.enum([
    'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting',
  ]),
  hourlyRateCents: z.number().finite().int().min(1).max(100_000_000),
  taxBasisPoints: z.number().finite().int().min(0).max(10_000),
  paymentTerms: z.enum(['Due on receipt', 'Net 14', 'Net 30']),
  countryCode: z.literal('US'),
  currency: z.literal('USD'),
  timeZone: z.string().trim().min(1).max(100),
  onboardingVersion: z.literal(1),
  onboardingCompletedAt: TimestampSchema,
}).strict()

export const createOnboardingMutation = ({
  lease,
  mutationId,
  now,
  profile,
}: {
  lease: AuthenticatedOwnerLease
  mutationId: string
  now: string
  profile: OnboardingProfileV1
}): MutationEnvelope => {
  if (!isCanonicalOwnerId(lease.ownerId)) {
    throw new Error('A canonical authenticated owner is required')
  }
  CanonicalUuidSchema.parse(mutationId)
  TimestampSchema.parse(now)
  const onboarding = OnboardingProfileSchema.parse(profile)
  if (onboarding.onboardingCompletedAt !== now) {
    throw new Error('The onboarding completion timestamp must match the mutation timestamp')
  }
  const payload: UserProfile = {
    id: lease.ownerId,
    ownerId: lease.ownerId,
    version: 0,
    createdAt: now,
    updatedAt: now,
    syncState: 'pending',
    ...onboarding,
  }
  return {
    id: mutationId,
    ownerId: lease.ownerId,
    entity: 'profile',
    entityId: lease.ownerId,
    kind: 'create',
    baseVersion: null,
    payload,
    createdAt: now,
    attempts: 0,
  }
}

type OnboardingRepository = {
  transactLocalMutation(mutation: MutationEnvelope): Promise<void>
}

export const createOnboardingSaver = (dependencies: {
  lease: AuthenticatedOwnerLease
  repository: OnboardingRepository
  createMutationId(): string
  now?(): string
}) => {
  const { lease, repository, createMutationId } = dependencies
  let retainedMutation: MutationEnvelope | null = null
  let retainedProfileJson: string | null = null
  let inFlight: Promise<void> | null = null

  return {
    save(profile: OnboardingProfileV1): Promise<void> {
      const canonicalProfile = OnboardingProfileSchema.parse(profile)
      const profileJson = JSON.stringify(canonicalProfile)
      if (retainedMutation && retainedProfileJson !== profileJson) {
        return Promise.reject(new Error('Complete the pending onboarding save before changing its content.'))
      }
      retainedMutation ??= createOnboardingMutation({
        lease,
        mutationId: createMutationId(),
        now: canonicalProfile.onboardingCompletedAt,
        profile: canonicalProfile,
      })
      retainedProfileJson ??= profileJson
      if (inFlight) return inFlight

      const mutation = retainedMutation
      inFlight = repository.transactLocalMutation(mutation).then(() => {
        retainedMutation = null
        retainedProfileJson = null
      }).catch(() => {
        throw new Error('Unable to save your profile securely.')
      }).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
