import type { ConfigContext, ExpoConfig } from 'expo/config'

export default function appConfig(_context: ConfigContext): ExpoConfig {
  void _context
  const revenueCatAppleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? ''
  if (
    process.env.EAS_BUILD_PROFILE === 'production' &&
    !/^appl_[A-Za-z0-9_-]{8,}$/.test(revenueCatAppleApiKey)
  ) {
    throw new Error('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY is required for production builds')
  }

  return {
    name: 'FieldCraft',
    slug: 'fieldcraft',
    version: '1.0.0',
    icon: './assets/icon.png',
    orientation: 'portrait',
    scheme: 'fieldcraft',
    userInterfaceStyle: 'automatic',
    updates: { enabled: false },
    newArchEnabled: true,
    ios: {
      bundleIdentifier: 'com.avinashamanchi.fieldcraft',
      buildNumber: '1',
      icon: './assets/icon.png',
      supportsTablet: false,
      usesAppleSignIn: false,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSMicrophoneUsageDescription: 'FieldCraft uses the microphone only while you record a job description for an editable invoice draft.',
        NSSpeechRecognitionUsageDescription: 'FieldCraft converts your spoken job description into editable text on this device.',
        NSCameraUsageDescription: 'FieldCraft uses the camera only when you choose to scan a receipt on this device.',
        NSPhotoLibraryUsageDescription: 'FieldCraft lets you choose a receipt or business logo that you explicitly select.',
      },
    },
    plugins: [
      'expo-router',
      'expo-sqlite',
      'expo-secure-store',
      ['expo-splash-screen', { backgroundColor: '#1A1A1A', image: './assets/icon.png', imageWidth: 160, resizeMode: 'contain' }],
      ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      privacyPolicyUrl: 'https://avinashamanchi.github.io/fieldcraft/privacy.html',
      supportUrl: 'https://avinashamanchi.github.io/fieldcraft/support.html',
      termsOfUseUrl: 'https://avinashamanchi.github.io/fieldcraft/terms.html',
    },
  }
}
