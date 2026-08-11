import { createAiClient } from '../src/ai/aiClient'
import { AI_CONSENT_VERSION } from '../src/ai/contracts'

const request = {
  route: 'expense.categorize.v1' as const,
  consentVersion: AI_CONSENT_VERSION,
  vendor: 'Field Supply',
  amountCents: 1299,
  notes: 'Copper fitting',
}

const response = (body: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  body: null,
  text: async () => body,
}) as unknown as Response

it('rejects non-HTTPS and provider URLs before sending data', () => {
  expect(() => createAiClient({ functionUrl: 'http://example.test/fieldcraft-ai' })).toThrow(/https/i)
  expect(() => createAiClient({ functionUrl: 'https://api.groq.com/openai/v1' })).toThrow(/function url/i)
  expect(() => createAiClient({ functionUrl: 'https://attacker.example/functions/v1/fieldcraft-ai' })).toThrow(/function url/i)
})

it('requires consent and a Supabase access token before fetch', async () => {
  const fetcher = jest.fn()
  const withoutConsent = createAiClient({
    functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai', fetcher,
    consent: { hasConsent: async () => false }, getAccessToken: async () => 'token',
  })
  await expect(withoutConsent.request('owner-a', request)).rejects.toMatchObject({ reason: 'consent-required' })
  expect(fetcher).not.toHaveBeenCalled()

  const withoutToken = createAiClient({
    functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai', fetcher,
    consent: { hasConsent: async () => true }, getAccessToken: async () => null,
  })
  await expect(withoutToken.request('owner-a', request)).rejects.toMatchObject({ reason: 'reauthentication' })
  expect(fetcher).not.toHaveBeenCalled()
})

it('uses only the Supabase bearer token and validates a versioned response', async () => {
  const fetcher = jest.fn(async () => response(JSON.stringify({
    route: request.route,
    version: 1,
    result: { category: 'Materials' },
  })))
  const client = createAiClient({
    functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai', fetcher,
    consent: { hasConsent: async () => true }, getAccessToken: async () => 'supabase-access-token',
  })
  await expect(client.request('owner-a', request)).resolves.toEqual({ category: 'Materials' })
  expect(fetcher).toHaveBeenCalledWith(
    'https://project.supabase.co/functions/v1/fieldcraft-ai',
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer supabase-access-token' }) }),
  )
  expect(JSON.stringify(fetcher.mock.calls)).not.toMatch(/groq/i)
})

it('bounds response bytes and never exposes a provider body in public errors', async () => {
  const marker = 'UNIQUE_PRIVATE_TRANSCRIPT_MARKER'
  const client = createAiClient({
    functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai',
    fetcher: async () => response(marker.repeat(140_000), 502),
    consent: { hasConsent: async () => true }, getAccessToken: async () => 'token',
  })
  const error = await client.request('owner-a', request).catch((cause: unknown) => cause)
  expect(error).toMatchObject({ reason: 'invalid-response' })
  expect(String(error)).not.toContain(marker)
})

it('propagates cancellation while the bounded body is still being read', async () => {
  let release!: (value: string) => void
  const body = new Promise<string>((resolve) => { release = resolve })
  const client = createAiClient({
    functionUrl: 'https://project.supabase.co/functions/v1/fieldcraft-ai',
    fetcher: async () => ({ ok: true, status: 200, body: null, text: () => body }) as unknown as Response,
    consent: { hasConsent: async () => true }, getAccessToken: async () => 'token', deadlineMs: 20_000,
  })
  const controller = new AbortController()
  const pending = client.request('owner-a', request, controller.signal)
  controller.abort()
  release(JSON.stringify({ route: request.route, version: 1, result: { category: 'Other' } }))
  await expect(pending).rejects.toMatchObject({ reason: 'cancelled' })
})
