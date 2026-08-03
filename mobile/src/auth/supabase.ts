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

const readConfiguration = (env: SupabaseEnvironment): { url: string; key: string } => {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim()
  const key = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key || url === EXAMPLE_URL || key === EXAMPLE_KEY) {
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
