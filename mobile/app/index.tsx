import { Redirect } from 'expo-router'

import { useAuth } from '../src/auth/AuthProvider'

export default function IndexScreen() {
  const auth = useAuth()
  return auth.status === 'signedIn'
    ? <Redirect href="/(tabs)" />
    : <Redirect href="/(auth)/login" />
}
