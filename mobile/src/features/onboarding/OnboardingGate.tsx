import { type PropsWithChildren, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import type { AuthenticatedOwnerLease } from '../../auth/AuthProvider'
import type { UserProfile } from '../../domain/entities'
import { colors } from '../../theme/tokens'

type ProfileRepository = {
  get(entity: 'profile', id: string): Promise<unknown | null>
}

type GateState = 'checking' | 'complete' | 'redirecting' | 'error'

const isCompleteProfile = (value: unknown, ownerId: string): value is UserProfile => {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<UserProfile>
  return (
    profile.id === ownerId &&
    profile.ownerId === ownerId &&
    profile.onboardingVersion === 1 &&
    typeof profile.onboardingCompletedAt === 'string' &&
    Number.isFinite(Date.parse(profile.onboardingCompletedAt)) &&
    typeof profile.displayName === 'string' && profile.displayName.length > 0 &&
    typeof profile.businessName === 'string' && profile.businessName.length > 0 &&
    typeof profile.tradeType === 'string' &&
    Number.isSafeInteger(profile.hourlyRateCents) &&
    Number.isSafeInteger(profile.taxBasisPoints) &&
    profile.countryCode === 'US' &&
    profile.currency === 'USD' &&
    typeof profile.timeZone === 'string' && profile.timeZone.length > 0
  )
}

const isIncompleteProfile = (value: unknown, ownerId: string): boolean => {
  if (!value || typeof value !== 'object') return false
  const profile = value as {
    id?: unknown
    ownerId?: unknown
    businessName?: unknown
    onboardingVersion?: unknown
  }
  return (
    profile.id === ownerId &&
    profile.ownerId === ownerId &&
    typeof profile.businessName === 'string' &&
    (profile.onboardingVersion === undefined || profile.onboardingVersion === 0)
  )
}

export const OnboardingGate = ({
  children,
  lease,
  repository,
  repositoryOwnerId,
  replace,
}: PropsWithChildren<{
  lease: AuthenticatedOwnerLease | null
  repository: ProfileRepository
  repositoryOwnerId: string | null
  replace(route: '/(auth)/onboarding'): void
}>) => {
  const [state, setState] = useState<GateState>('checking')
  const [detail, setDetail] = useState('')
  const [approvedLeaseKey, setApprovedLeaseKey] = useState<string | null>(null)
  const leaseKey = lease
    ? `${lease.ownerId}:${lease.sessionGeneration}:${lease.repositoryRevision}`
    : null

  useEffect(() => {
    let current = true
    setState('checking')
    setDetail('')
    setApprovedLeaseKey(null)
    if (!lease || repositoryOwnerId !== lease.ownerId) return () => { current = false }
    const expectedLease = lease
    void repository.get('profile', expectedLease.ownerId).then((profile) => {
      if (!current) return
      if (!profile || isIncompleteProfile(profile, expectedLease.ownerId)) {
        setState('redirecting')
        replace('/(auth)/onboarding')
        return
      }
      if (!isCompleteProfile(profile, expectedLease.ownerId)) {
        throw new Error('The saved onboarding profile is invalid.')
      }
      setApprovedLeaseKey(
        `${expectedLease.ownerId}:${expectedLease.sessionGeneration}:${expectedLease.repositoryRevision}`,
      )
      setState('complete')
    }).catch((error: unknown) => {
      if (!current) return
      setDetail(error instanceof Error ? error.message : String(error))
      setState('error')
    })
    return () => { current = false }
  }, [lease, replace, repository, repositoryOwnerId])

  if (
    state === 'complete' &&
    leaseKey !== null &&
    approvedLeaseKey === leaseKey &&
    repositoryOwnerId === lease?.ownerId
  ) return children
  if (state === 'error') {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.error}>
          Local data could not be prepared securely.
          {__DEV__ && detail ? `\nDevelopment detail: ${detail}` : ''}
        </Text>
      </View>
    )
  }
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.orange} />
      <Text style={styles.text}>
        {state === 'redirecting' ? 'Opening secure setup…' : 'Checking secure setup…'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    backgroundColor: colors.charcoal,
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  error: { color: colors.danger, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  text: { color: colors.warmWhite, fontSize: 17, lineHeight: 24, textAlign: 'center' },
})
