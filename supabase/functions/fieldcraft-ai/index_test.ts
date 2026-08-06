import { AI_CONSENT_VERSION, type AiRequest } from '../_shared/contracts.ts'
import { callProvider } from '../_shared/provider.ts'
import { createHandler, createProductionHandler } from './index.ts'

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const valid = { route: 'expense.categorize.v1', consentVersion: AI_CONSENT_VERSION, vendor: 'Supply', amountCents: 500, notes: '' }
const make = (overrides: Record<string, unknown> = {}) => {
  const logs: Record<string, unknown>[] = []
  const handler = createHandler({
    allowedOrigins: new Set(['https://app.example']),
    authenticateRequest: async () => ({ userId: '70000000-0000-0000-0000-000000000007' }),
    consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    digest: async (value) => `digest-${value.split(':')[0]}`,
    invokeProvider: async () => ({ category: 'Materials' }),
    log: (entry) => logs.push(entry),
    ...overrides,
  })
  return { handler, logs }
}

Deno.test('OPTIONS is bounded to an allowed CORS origin', async () => {
  const { handler } = make()
  const response = await handler(new Request('https://edge.example', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }))
  assert(response.status === 204, 'OPTIONS status')
  assert(response.headers.get('access-control-allow-origin') === 'https://app.example', 'CORS origin')
})

Deno.test('rejects non-POST, missing auth, wrong route, unknown fields, and oversized input', async () => {
  const authFailure = make({ authenticateRequest: async () => { throw new Error('unauthorized') } }).handler
  assert((await authFailure(new Request('https://edge.example', { method: 'POST', body: '{}' }))).status === 401, 'missing auth')
  const { handler } = make()
  assert((await handler(new Request('https://edge.example'))).status === 405, 'method')
  assert((await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({ ...valid, route: 'wrong' }) }))).status === 400, 'route')
  assert((await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({ ...valid, extra: true }) }))).status === 400, 'unknown field')
  assert((await handler(new Request('https://edge.example', { method: 'POST', body: 'x'.repeat(65 * 1024) }))).status === 413, 'body cap')
})

Deno.test('rejects wrong consent and a 20001-code-point transcript', async () => {
  const { handler } = make()
  const wrongConsent = await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({ ...valid, consentVersion: 'old' }) }))
  assert(wrongConsent.status === 400, 'consent')
  const transcript = { route: 'invoice.parse.v1', consentVersion: AI_CONSENT_VERSION, transcript: 'x'.repeat(20_001), defaults: { tradeType: 'General', hourlyRateCents: 0, taxBasisPoints: 0 } }
  assert((await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify(transcript) }))).status === 400, 'transcript cap')
})

Deno.test('applies independent rate limits and returns an integer retry', async () => {
  const scopes: string[] = []
  const { handler } = make({ consume: async (scope: string) => { scopes.push(scope); return { allowed: scope === 'digest-user', retryAfterSeconds: 17 } } })
  const response = await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify(valid) }))
  const body = await response.json()
  assert(response.status === 429 && body.retryAfterSeconds === 17, 'rate result')
  assert(scopes.includes('digest-user') && scopes.includes('digest-network'), 'independent scopes')
})

Deno.test('returns versioned output without logging or exposing private content', async () => {
  const marker = 'UNIQUE_PRIVATE_TRANSCRIPT_MARKER'
  const { handler, logs } = make({ invokeProvider: async (_request: AiRequest) => ({ category: 'Other' }) })
  const response = await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({ ...valid, notes: marker }) }))
  const text = await response.text()
  assert(response.status === 200 && text.includes('"version":1'), 'versioned output')
  assert(!JSON.stringify(logs).includes(marker), 'private content in log')
})

Deno.test('maps provider timeout and invalid provider response to content-free public errors', async () => {
  const marker = 'PRIVATE_PROVIDER_BODY'
  for (const [message, status] of [['provider-timeout', 504], ['invalid-provider-response', 502]] as const) {
    const { handler } = make({ invokeProvider: async () => { throw new Error(message) } })
    const response = await handler(new Request('https://edge.example', { method: 'POST', body: JSON.stringify({ ...valid, notes: marker }) }))
    const text = await response.text()
    assert(response.status === status && !text.includes(marker), message)
  }
})

Deno.test('provider access enforces its deadline, byte cap, and strict schema', async () => {
  const base = {
    apiKey: 'server-only-key', endpoint: 'https://provider.example/v1', model: 'model',
  }
  const timeoutRequest = callProvider(valid as AiRequest, {
    ...base, timeoutMs: 5,
    fetcher: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }),
  })
  await assertRejects(timeoutRequest, 'provider-timeout')

  const oversized = JSON.stringify({ choices: [{ message: { content: 'x'.repeat(129 * 1024) } }] })
  await assertRejects(callProvider(valid as AiRequest, { ...base, fetcher: async () => new Response(oversized) }), 'invalid-provider-response')
  const malformed = JSON.stringify({ choices: [{ message: { content: '{"category":"Not allowed"}' } }] })
  await assertRejects(callProvider(valid as AiRequest, { ...base, fetcher: async () => new Response(malformed) }), 'invalid-provider-response')
})

Deno.test('production handler refuses missing server secrets at startup', () => {
  let message = ''
  try { createProductionHandler({}) } catch (cause) { message = cause instanceof Error ? cause.message : String(cause) }
  assert(message.includes('SUPABASE_URL'), 'missing configuration did not fail closed')
})

const assertRejects = async (operation: Promise<unknown>, expected: string) => {
  let message = ''
  try { await operation } catch (cause) { message = cause instanceof Error ? cause.message : String(cause) }
  assert(message === expected, `expected ${expected}, received ${message}`)
}
