import { Stack } from 'expo-router'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useState, type PropsWithChildren } from 'react'
import 'react-native-gesture-handler'
import 'react-native-reanimated'

import { AuthProvider, useAuth } from '../src/auth/AuthProvider'
import { DataProvider, useFieldCraftData } from '../src/data/DataProvider'
import { SQLiteFieldCraftRepository } from '../src/data/sqliteRepository'
import { SyncProvider } from '../src/data/SyncProvider'
import { InvoiceSessionProvider } from '../src/features/invoices/invoiceSession'

const HydrationGate = ({ children }: PropsWithChildren) => {
  const auth = useAuth()
  if (auth.status === 'initializing' || (auth.status === 'signedIn' && !auth.hydrated)) {
    return (
      <View accessibilityLabel="Preparing FieldCraft data" style={styles.centered}>
        <ActivityIndicator />
        <Text>Preparing your secure workspace…</Text>
      </View>
    )
  }
  if (auth.status === 'storageError') {
    return (
      <View style={styles.centered}>
        <Text accessibilityRole="alert">{auth.message}</Text>
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
          <HydrationGate>{children}</HydrationGate>
        </InvoiceSessionBoundary>
      </SyncProvider>
    </DataProvider>
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
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
  },
  root: { flex: 1 },
})
