import type { ConfigContext, ExpoConfig } from 'expo/config'

export default function appConfig(_context: ConfigContext): ExpoConfig {
  void _context

  return {
    name: 'FieldCraft',
    slug: 'fieldcraft',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'fieldcraft',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'com.avinashamanchi.fieldcraft',
      buildNumber: '1',
      supportsTablet: true,
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      'expo-secure-store',
      ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
    ],
    experiments: {
      typedRoutes: true,
    },
  }
}
