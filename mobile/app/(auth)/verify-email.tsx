import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function VerifyEmailScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text accessibilityRole="header" style={styles.title}>Check your email</Text>
        <Text style={styles.body}>
          Open the FieldCraft verification link on this device. Local business records stay locked until verification and hydration finish.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/(auth)/login')}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Back to sign in</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#F7F4ED', flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { color: '#17251C', fontSize: 34, fontWeight: '800', marginBottom: 16 },
  body: { color: '#4D5B52', fontSize: 17, lineHeight: 26, marginBottom: 28 },
  button: {
    alignItems: 'center', backgroundColor: '#1F603C', borderRadius: 12, justifyContent: 'center', minHeight: 52,
  },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
})
