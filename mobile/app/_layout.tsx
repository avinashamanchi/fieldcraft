import { Stack } from 'expo-router'
import { View } from 'react-native'
import 'react-native-gesture-handler'
import 'react-native-reanimated'

export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  )
}
