import { router, Stack, useSegments } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useEffect, useState, type PropsWithChildren } from 'react'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import 'react-native-gesture-handler'
import 'react-native-reanimated'

import {
  AuthProvider,
  useAuth,
  useAuthenticatedOwnerLease,
} from '../src/auth/AuthProvider'
import { DataProvider, useFieldCraftData } from '../src/data/DataProvider'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import { SyncProvider } from '../src/data/SyncProvider'
import { EntitlementStore } from '../src/billing/entitlementStore'
import { AdmissionControlledFieldCraftRepository } from '../src/billing/featureAdmission'
import {
  SubscriptionCoordinator,
  SubscriptionProvider,
} from '../src/billing/SubscriptionProvider'
import {
  createNativePurchasesPort,
  createRevenueCatClient,
} from '../src/billing/revenueCatClient'
import {
  createFeatureAdmissionGateway,
  createServerEntitlementGateway,
} from '../src/data/supabaseGateway'
import { InvoiceSessionProvider } from '../src/features/invoices/invoiceSession'
import { OnboardingGate } from '../src/features/onboarding/OnboardingGate'
import { colors } from '../src/theme/tokens'

const HydrationGate = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  if (auth.status === 'initializing' || (auth.status === 'signedIn' && !auth.hydrated)) {
    return (
      <View accessibilityLabel="Preparing FieldCraft data" style={styles.centered}>
        <ActivityIndicator color={colors.orange} />
        <Text style={styles.bootText}>Preparing your secure workspace…</Text>
      </View>
    )
  }
  if (auth.status === 'storageError') {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert" style={styles.bootError}>{auth.message}</Text>
      </View>
    )
  }
  return children
}

const RepositoryProviders = ({
  repository,
  children,
}: PropsWithChildren<{ repository: SQLiteFieldCraftRepository }>) => {
  const auth = useAuth()
  const ownerId = auth.status === 'signedIn' ? auth.userId : null
  return (
    <DataProvider ownerId={ownerId} repository={repository}>
      <SyncProvider>
        <InvoiceSessionBoundary>
          <HydrationGate>
            <ProductRouteBoundary>{children}</ProductRouteBoundary>
          </HydrationGate>
        </InvoiceSessionBoundary>
      </SyncProvider>
    </DataProvider>
  )
}

const PUBLIC_AUTH_ROUTES = new Set(['login', 'signup', 'reset-password', 'verify-email'])

export const ProductRouteBoundary = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  const lease = useAuthenticatedOwnerLease()
  const { owner, repository } = useFieldCraftData()
  const segments: readonly string[] = useSegments()
  const routeRoot = String(segments[0] ?? '')
  const routeLeaf = String(segments[1] ?? '')
  const publicRoute = routeRoot === 'privacy' || (
    routeRoot === '(auth)' && PUBLIC_AUTH_ROUTES.has(routeLeaf)
  )
  const onboardingRoute = routeRoot === '(auth)' && routeLeaf === 'onboarding'
  const redirectRoute = !publicRoute && auth.status === 'signedOut'
    ? '/(auth)/login'
    : !publicRoute && auth.status === 'verificationRequired'
      ? '/(auth)/verify-email'
      : null
  const admittedOwner = auth.status === 'signedIn' && auth.hydrated && lease !== null &&
    lease.ownerId === auth.userId && repositoryOwnerIdMatches(owner.ownerId, lease.ownerId)

  useEffect(() => {
    if (redirectRoute) router.replace(redirectRoute)
  }, [redirectRoute])

  if (publicRoute) return children
  if (redirectRoute || !admittedOwner) {
    return (
      <View accessibilityLabel="Checking FieldCraft access" style={styles.centered}>
        <ActivityIndicator color={colors.orange} />
        <Text style={styles.bootText}>Checking secure access…</Text>
      </View>
    )
  }
  if (onboardingRoute) return children
  return (
    <OnboardingGate
      lease={lease}
      repository={repository}
      repositoryOwnerId={owner.ownerId}
      replace={(route) => router.replace(route)}
    >
      {children}
    </OnboardingGate>
  )
}

const repositoryOwnerIdMatches = (
  repositoryOwnerId: string | null,
  leaseOwnerId: string,
): boolean => repositoryOwnerId !== null && repositoryOwnerId === leaseOwnerId

const InvoiceSessionBoundary = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  const { owner, repository } = useFieldCraftData()
  const signedInOwner = auth.status === 'signedIn' ? auth.userId : null
  const ownerId = signedInOwner === owner.ownerId ? signedInOwner : null
  return <InvoiceSessionProvider ownerId={ownerId} repository={repository}>{children}</InvoiceSessionProvider>
}

export default function RootLayout() {
  const [resources] = useState(() => {
    const store = new EntitlementStore()
    const client = createRevenueCatClient({
      apiKey: process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY ?? '',
      purchases: createNativePurchasesPort(),
      isExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    })
    return {
      repository: new AdmissionControlledFieldCraftRepository({
        entitlementStore: store,
        gateway: createFeatureAdmissionGateway(),
      }),
      store,
      coordinator: new SubscriptionCoordinator(
        client,
        createServerEntitlementGateway(),
        store,
      ),
    }
  })
  const repository = resources.repository
  const [authLifecycle] = useState(() => ({
    initialize: (ownerId: string) => repository.initialize(ownerId),
    deactivateOwner: () => {
      resources.coordinator.invalidateBeforeTeardown()
      repository.deactivateOwner()
    },
    clearOwner: (ownerId: string) => repository.clearOwner(ownerId),
    hasCompletedInitialPull: (ownerId: string) => repository.hasCompletedInitialPull(ownerId),
    waitForInitialPull: (ownerId: string) => repository.waitForInitialPull(ownerId),
    ownerBoundary: repository.ownerBoundary,
  }))
  return (
    <AuthProvider dataLifecycle={authLifecycle}>
      <SubscriptionProvider coordinator={resources.coordinator} store={resources.store}>
        <RepositoryProviders repository={repository}>
          <View style={styles.root}>
            <Stack screenOptions={{ headerShown: false }} />
          </View>
        </RepositoryProviders>
      </SubscriptionProvider>
    </AuthProvider>
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
  bootError: { color: colors.danger, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  bootText: { color: colors.warmWhite, fontSize: 17, lineHeight: 24, textAlign: 'center' },
  root: { backgroundColor: colors.charcoal, flex: 1 },
})
