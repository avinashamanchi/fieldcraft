import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { Pressable, type PressableProps } from 'react-native'

import { colors, MIN_TOUCH_TARGET, typography } from '../../src/theme/tokens'

const tabButton = (testID: string, label: string) => {
  const FieldCraftTabButton = (props: PressableProps) => (
    <Pressable
      {...props}
      accessibilityLabel={`${label} tab`}
      accessibilityRole="tab"
      style={(state) => [
        typeof props.style === 'function' ? props.style(state) : props.style,
        { minHeight: MIN_TOUCH_TARGET },
      ]}
      testID={testID}
    />
  )
  FieldCraftTabButton.displayName = `${label}TabButton`
  return FieldCraftTabButton
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: typography.utility, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.panel, borderTopColor: '#353535' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarButton: tabButton('tab-dashboard', 'Dashboard'),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="grid-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarButton: tabButton('tab-jobs', 'Jobs'),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="hammer-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="estimates"
        options={{
          title: 'Estimates',
          tabBarButton: tabButton('tab-estimates', 'Estimates'),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="document-text-outline" size={size} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          tabBarButton: tabButton('tab-clients', 'Clients'),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="people-outline" size={size} />,
        }}
      />
      <Tabs.Screen name="expenses" options={{ href: null }} />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarButton: tabButton('tab-settings', 'Settings'),
          tabBarIcon: ({ color, size }) => <Ionicons color={color} name="settings-outline" size={size} />,
        }}
      />
    </Tabs>
  )
}
