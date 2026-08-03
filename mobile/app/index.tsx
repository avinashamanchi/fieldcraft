import { StyleSheet, Text, View } from 'react-native'

export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>FieldCraft</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
})
