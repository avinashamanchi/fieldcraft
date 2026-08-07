import { router, Stack, useSegments } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useState, type PropsWithChildren } from 'react'
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

const ProductRouteBoundary = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  const lease = useAuthenticatedOwnerLease()
  const { owner, repository } = useFieldCraftData()
  const segments = useSegments()
  const publicRoute = segments[0] === '(auth)' || segments[0] === 'privacy'
  if (publicRoute || auth.status !== 'signedIn' || !auth.hydrated) return children
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

const InvoiceSessionBoundary = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  const { owner, repository } = useFieldCraftData()
  const signedInOwner = auth.status === 'signedIn' ? auth.userId : null
  const ownerId = signedInOwner === owner.ownerId ? signedInOwner : null
  return <InvoiceSessionProvider ownerId={ownerId} repository={repository}>{children}</InvoiceSessionProvider>
}

export default function RootLayout() {
  const [repository] = useState(() => new SQLiteFieldCraftRepository())
  return (
    <AuthProvider dataLifecycle={repository}>
      <RepositoryProviders repository={repository}>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false }} />
        </View>
      </RepositoryProviders>
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
