import * as Crypto from 'expo-crypto'

const LINK_ERROR_MESSAGE = 'This authentication link could not be completed.'
const MAX_TOKEN_LENGTH = 4_096

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
  constructor(_cause?: unknown) {
    super(LINK_ERROR_MESSAGE)
    void _cause
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

export const parseAuthDeepLink = (input: string): AuthDeepLink => {
  let url: URL
  try {
    url = new URL(input)
  } catch (error) {
    throw new AuthDeepLinkError(error)
  }
  if (
    url.protocol !== 'fieldcraft:' ||
    url.hostname !== 'auth' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.hash !== ''
  ) {
    throw new AuthDeepLinkError()
  }

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
}

export const createAuthDeepLinkProcessor = (
  dependencies: AuthDeepLinkProcessorDependencies,
): AuthDeepLinkProcessor => {
  const pending = new Map<string, Promise<void>>()
  const completed = new Set<string>()
  const completionOrder: string[] = []

  return {
    async handle(input) {
      const link = parseAuthDeepLink(input)
      try {
        const sensitiveValue = link.kind === 'callback' ? link.code : link.tokenHash
        const fingerprint = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          `${link.kind}:${sensitiveValue}`,
        )
        if (completed.has(fingerprint)) return 'duplicate'
        const existing = pending.get(fingerprint)
        if (existing) {
          await existing
          return 'duplicate'
        }

        const operation = (async () => {
          if (link.kind === 'callback') await dependencies.exchangeCode(link.code)
          else if (link.kind === 'verify') await dependencies.verifySignup(link.tokenHash)
          else await dependencies.recoverPassword(link.tokenHash)
        })()
        pending.set(fingerprint, operation)
        try {
          await operation
          completed.add(fingerprint)
          completionOrder.push(fingerprint)
          if (completionOrder.length > 64) {
            const oldest = completionOrder.shift()
            if (oldest) completed.delete(oldest)
          }
          return 'processed'
        } finally {
          pending.delete(fingerprint)
        }
      } catch (error) {
        if (error instanceof AuthDeepLinkError) throw error
        throw new AuthDeepLinkError(error)
      } finally {
        dependencies.replace(link.safeRoute)
      }
    },
  }
}
