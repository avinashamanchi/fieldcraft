import 'react-native-url-polyfill/auto'

import {
  createClient,
  processLock,
  type SupabaseClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js'

import { secureStoreAuthStorage } from './secureStoreAuthStorage'

const CONFIGURATION_ERROR_MESSAGE = 'FieldCraft authentication is not configured.'
const EXAMPLE_URL = 'https://your-project-id.supabase.co'
const EXAMPLE_KEY = 'your-anon-key-here'
const MODERN_PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/
const JWT_SEGMENT = /^[A-Za-z0-9_-]+$/

export class SupabaseConfigurationError extends Error {
  constructor() {
    super(CONFIGURATION_ERROR_MESSAGE)
    this.name = 'SupabaseConfigurationError'
  }
}

type SupabaseEnvironment = {
  EXPO_PUBLIC_SUPABASE_URL?: string
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string
}

type ClientFactory = (
  url: string,
  key: string,
  options: SupabaseClientOptions<'public'>,
) => unknown

type CreateConfiguredSupabaseClientOptions = {
  env?: SupabaseEnvironment
  clientFactory?: ClientFactory
  storage?: typeof secureStoreAuthStorage
}

const decodeJwtObject = (segment: string): Record<string, unknown> | null => {
  if (!JWT_SEGMENT.test(segment) || segment.length % 4 === 1) return null
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const parsed: unknown = JSON.parse(globalThis.atob(padded))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const isAllowedPublishableKey = (key: string): boolean => {
  if (MODERN_PUBLISHABLE_KEY.test(key)) return true
  const segments = key.split('.')
  if (segments.length !== 3 || segments.some((segment) => !JWT_SEGMENT.test(segment))) {
    return false
  }
  const header = decodeJwtObject(segments[0])
  const payload = decodeJwtObject(segments[1])
  return header?.typ === 'JWT' && typeof header.alg === 'string' && payload?.role === 'anon'
}

const readConfiguration = (env: SupabaseEnvironment): { url: string; key: string } => {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim()
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (
    !url ||
    !key ||
    url === EXAMPLE_URL ||
    key === EXAMPLE_KEY ||
    !isAllowedPublishableKey(key)
  ) {
    throw new SupabaseConfigurationError()
  }
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new SupabaseConfigurationError()
    }
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) throw error
    throw new SupabaseConfigurationError()
  }
  return { url, key }
}

export const createConfiguredSupabaseClient = <T = SupabaseClient>(
  options: CreateConfiguredSupabaseClientOptions = {},
): T => {
  const environment = options.env ?? {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  }
  const { url, key } = readConfiguration(environment)
  const clientFactory = options.clientFactory ?? createClient
  return clientFactory(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
      lock: processLock,
      persistSession: true,
      storage: options.storage ?? secureStoreAuthStorage,
    },
  }) as T
}

let configuredClient: SupabaseClient | null = null

export const getSupabaseClient = (): SupabaseClient => {
  if (configuredClient) return configuredClient
  const client = createConfiguredSupabaseClient<SupabaseClient>()
  configuredClient = client
  return client
}
