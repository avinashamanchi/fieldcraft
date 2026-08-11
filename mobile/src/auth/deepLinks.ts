import * as Crypto from 'expo-crypto'

const LINK_ERROR_MESSAGE = 'This authentication link could not be completed.'
const MAX_TOKEN_LENGTH = 4_096
const MAX_DEDUPE_ENTRIES = 64

export type SafeAuthRoute =
  | '/(auth)/login'
  | '/(auth)/verify-email'
  | '/(auth)/reset-password'

export type AuthDeepLink =
  | { kind: 'callback'; code: string; safeRoute: '/(auth)/login' }
  | {
      kind: 'verify'
      tokenHash: string
      type: 'signup'
      safeRoute: '/(auth)/verify-email'
    }
  | {
      kind: 'reset'
      tokenHash: string
      type: 'recovery'
      safeRoute: '/(auth)/reset-password'
    }

export class AuthDeepLinkError extends Error {
  constructor() {
    super(LINK_ERROR_MESSAGE)
    this.name = 'AuthDeepLinkError'
  }
}

const requireExactParameters = (
  url: URL,
  expectedNames: readonly string[],
): Record<string, string> => {
  const actualNames = [...url.searchParams.keys()]
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name) => !expectedNames.includes(name))
  ) {
    throw new AuthDeepLinkError()
  }
  const values: Record<string, string> = {}
  for (const name of expectedNames) {
    const matches = url.searchParams.getAll(name)
    if (matches.length !== 1 || matches[0].length < 1 || matches[0].length > MAX_TOKEN_LENGTH) {
      throw new AuthDeepLinkError()
    }
    values[name] = matches[0]
  }
  return values
}

const readAuthUrl = (input: string): URL => {
  try {
    return new URL(input)
  } catch {
    throw new AuthDeepLinkError()
  }
}

const isExactAuthOrigin = (url: URL): boolean =>
  url.protocol === 'fieldcraft:' &&
  url.hostname === 'auth' &&
  url.username === '' &&
  url.password === '' &&
  url.port === '' &&
  url.hash === ''

const recognizedSafeRoute = (input: string): SafeAuthRoute | null => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'fieldcraft:' || url.hostname !== 'auth') return null
  if (url.pathname === '/callback') return '/(auth)/login'
  if (url.pathname === '/verify') return '/(auth)/verify-email'
  if (url.pathname === '/reset') return '/(auth)/reset-password'
  return null
}

export const parseAuthDeepLink = (input: string): AuthDeepLink => {
  const url = readAuthUrl(input)
  if (!isExactAuthOrigin(url)) throw new AuthDeepLinkError()

  if (url.pathname === '/callback') {
    const { code } = requireExactParameters(url, ['code'])
    return { kind: 'callback', code, safeRoute: '/(auth)/login' }
  }
  if (url.pathname === '/verify') {
    const { token_hash: tokenHash, type } = requireExactParameters(url, ['token_hash', 'type'])
    if (type !== 'signup') throw new AuthDeepLinkError()
    return { kind: 'verify', tokenHash, type, safeRoute: '/(auth)/verify-email' }
  }
  if (url.pathname === '/reset') {
    const { token_hash: tokenHash, type } = requireExactParameters(url, ['token_hash', 'type'])
    if (type !== 'recovery') throw new AuthDeepLinkError()
    return { kind: 'reset', tokenHash, type, safeRoute: '/(auth)/reset-password' }
  }
  throw new AuthDeepLinkError()
}

export type AuthDeepLinkProcessorDependencies = {
  exchangeCode(code: string): Promise<void>
  verifySignup(tokenHash: string): Promise<void>
  recoverPassword(tokenHash: string): Promise<void>
  replace(route: SafeAuthRoute): void
}

export type AuthDeepLinkProcessor = {
  handle(url: string): Promise<'processed' | 'duplicate'>
  cancel(): void
}

const sharedPending = new Map<string, Promise<void>>()
const sharedCompleted = new Set<string>()
const sharedCompletionOrder: string[] = []

const rememberCompletion = (fingerprint: string): void => {
  if (sharedCompleted.has(fingerprint)) return
  sharedCompleted.add(fingerprint)
  sharedCompletionOrder.push(fingerprint)
  if (sharedCompletionOrder.length > MAX_DEDUPE_ENTRIES) {
    const oldest = sharedCompletionOrder.shift()
    if (oldest) sharedCompleted.delete(oldest)
  }
}

export const createAuthDeepLinkProcessor = (
  dependencies: AuthDeepLinkProcessorDependencies,
): AuthDeepLinkProcessor => {
  let active = true

  return {
    cancel() {
      active = false
    },

    async handle(input) {
      const safeRoute = recognizedSafeRoute(input)
      try {
        const link = parseAuthDeepLink(input)
        const sensitiveValue = link.kind === 'callback' ? link.code : link.tokenHash
        const fingerprint = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          `${link.kind}:${sensitiveValue}`,
        )
        if (sharedCompleted.has(fingerprint)) return 'duplicate'

        let operation = sharedPending.get(fingerprint)
        let ownsOperation = false
        if (!operation) {
          if (sharedPending.size >= MAX_DEDUPE_ENTRIES) throw new AuthDeepLinkError()
          ownsOperation = true
          operation = (async () => {
            if (link.kind === 'callback') await dependencies.exchangeCode(link.code)
            else if (link.kind === 'verify') await dependencies.verifySignup(link.tokenHash)
            else await dependencies.recoverPassword(link.tokenHash)
          })()
          sharedPending.set(fingerprint, operation)
        }

        try {
          await operation
          if (ownsOperation) rememberCompletion(fingerprint)
          return ownsOperation ? 'processed' : 'duplicate'
        } finally {
          if (ownsOperation) sharedPending.delete(fingerprint)
        }
      } catch {
        throw new AuthDeepLinkError()
      } finally {
        if (active && safeRoute) dependencies.replace(safeRoute)
      }
    },
  }
}
