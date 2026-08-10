import type { ConfigContext, ExpoConfig } from 'expo/config'

const SUPABASE_EXAMPLE_URL = 'https://your-project-id.supabase.co'
const SUPABASE_EXAMPLE_KEY = 'your-anon-key-here'
const MODERN_SUPABASE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/

const isAnonSupabaseKey = (key: string): boolean => {
  if (MODERN_SUPABASE_KEY.test(key)) return true
  const segments = key.split('.')
  if (segments.length !== 3 || segments.some((segment) => !JWT_SEGMENT.test(segment))) return false
  try {
    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/')
    const decoded: unknown = JSON.parse(globalThis.atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '=')))
    return typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded)
      && (decoded as { role?: unknown }).role === 'anon'
  } catch {
    return false
  }
}

const hasSafeSupabaseConfiguration = (url: string, key: string): boolean => {
  if (!url || !key || url === SUPABASE_EXAMPLE_URL || key === SUPABASE_EXAMPLE_KEY || !isAnonSupabaseKey(key)) {
    return false
  }
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
  } catch {
    return false
  }
}

export default function appConfig(_context: ConfigContext): ExpoConfig {
  void _context
  const revenueCatAppleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY?.trim() ?? ''
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? ''
  const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  if (
    process.env.EAS_BUILD_PROFILE === 'production' &&
    !/^appl_[A-Za-z0-9_-]{8,}$/.test(revenueCatAppleApiKey)
  ) {
    throw new Error('EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY is required for production builds')
  }
  if (
    process.env.EAS_BUILD_PROFILE === 'production'
    && !hasSafeSupabaseConfiguration(supabaseUrl, supabasePublishableKey)
  ) {
    throw new Error('FieldCraft Supabase configuration is required and must be safe for production builds')
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
