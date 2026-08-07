import { isCanonicalOwnerId } from '../../auth/authService'
import type { AuthenticatedOwnerLease } from '../../auth/AuthProvider'
import {
  CanonicalMillisecondUtcTimestampSchema,
  OnboardingProfileV1Schema,
  type OnboardingProfileV1,
  type UserProfile,
} from '../../domain/entities'
import type { MutationEnvelope } from '../../domain/sync'

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
  if (!CANONICAL_UUID.test(mutationId)) throw new Error('A canonical mutation ID is required')
  CanonicalMillisecondUtcTimestampSchema.parse(now)
  const onboarding = OnboardingProfileV1Schema.parse(profile)
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
      const canonicalProfile = OnboardingProfileV1Schema.parse(profile)
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
