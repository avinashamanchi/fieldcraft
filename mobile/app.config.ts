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
      infoPlist: {
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
      ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
    ],
    experiments: {
      typedRoutes: true,
    },
  }
}
