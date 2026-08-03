jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'non-sensitive-fingerprint',
}))

import {
  AuthDeepLinkError,
  createAuthDeepLinkProcessor,
  parseAuthDeepLink,
} from '../src/auth/deepLinks'

it.each([
  [
    'fieldcraft://auth/callback?code=pkce-code',
    { kind: 'callback', code: 'pkce-code', safeRoute: '/(auth)/login' },
  ],
  [
    'fieldcraft://auth/verify?token_hash=signup-token&type=signup',
    {
      kind: 'verify',
      tokenHash: 'signup-token',
      type: 'signup',
      safeRoute: '/(auth)/verify-email',
    },
  ],
  [
    'fieldcraft://auth/reset?token_hash=recovery-token&type=recovery',
    {
      kind: 'reset',
      tokenHash: 'recovery-token',
      type: 'recovery',
      safeRoute: '/(auth)/reset-password',
    },
  ],
] as const)('parses the supported native auth route %s', (url, expected) => {
  expect(parseAuthDeepLink(url)).toEqual(expected)
})

it.each([
  'https://auth/callback?code=value',
  'fieldcraft://other/callback?code=value',
  'fieldcraft://auth/unknown?code=value',
  'fieldcraft://auth/callback',
  'fieldcraft://auth/callback?code=',
  'fieldcraft://auth/callback?code=one&code=two',
  'fieldcraft://auth/callback?code=value&extra=value',
  'fieldcraft://auth/verify?token_hash=value&type=recovery',
  'fieldcraft://auth/reset?token_hash=value&type=signup',
  'fieldcraft://auth/reset?token_hash=one&token_hash=two&type=recovery',
] as const)('rejects malformed or unapproved auth link %s', (url) => {
  expect(() => parseAuthDeepLink(url)).toThrow(AuthDeepLinkError)
})

it('processes duplicate verification links once and removes tokens from navigation state', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const verifySignup = jest.fn(async () => pending)
  const replace = jest.fn()
  const processor = createAuthDeepLinkProcessor({
    exchangeCode: jest.fn(),
    verifySignup,
    recoverPassword: jest.fn(),
    replace,
  })
  const url = 'fieldcraft://auth/verify?token_hash=sensitive-token&type=signup'

  const first = processor.handle(url)
  const duplicate = processor.handle(url)
  release()

  await expect(Promise.all([first, duplicate])).resolves.toEqual(['processed', 'duplicate'])
  expect(verifySignup).toHaveBeenCalledTimes(1)
  expect(replace).toHaveBeenCalledWith('/(auth)/verify-email')
  expect(JSON.stringify(replace.mock.calls)).not.toContain('sensitive-token')
})

it('redacts provider failures and clears recovery tokens even when processing fails', async () => {
  const replace = jest.fn()
  const processor = createAuthDeepLinkProcessor({
    exchangeCode: jest.fn(),
    verifySignup: jest.fn(),
    recoverPassword: async () => {
      throw new Error('provider included sensitive-recovery-token')
    },
    replace,
  })

  const failure = await processor
    .handle('fieldcraft://auth/reset?token_hash=sensitive-recovery-token&type=recovery')
    .catch((error: unknown) => error)
  expect(failure).toMatchObject({
    name: 'AuthDeepLinkError',
    message: 'This authentication link could not be completed.',
  })
  expect(failure).not.toHaveProperty('cause')
  expect(replace).toHaveBeenCalledWith('/(auth)/reset-password')
})
