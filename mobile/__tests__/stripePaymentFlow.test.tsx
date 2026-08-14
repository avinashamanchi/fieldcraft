import { createPaymentService, PaymentServiceError } from '../src/payments/paymentService'

it('rejects payment function URLs outside the exact Supabase project host and path', () => {
  const options = {
    getAccessToken: async () => 'access-token',
    requireRecentAal2: () => {},
  }

  expect(() => createPaymentService({
    ...options,
    functionBaseUrl: 'https://attacker.example/functions/v1',
  })).toThrow(/Supabase URL/i)
  expect(() => createPaymentService({
    ...options,
    functionBaseUrl: 'https://project.supabase.co/functions/v1/../admin',
  })).toThrow(/Supabase URL/i)
})

it('requires recent AAL2 and rejects an oversized provider response', async () => {
  let calls = 0
  const service = createPaymentService({
    functionBaseUrl: 'https://project.supabase.co/functions/v1',
    getAccessToken: async () => 'access-token',
    requireRecentAal2: () => { throw new Error('STEP_UP_REQUIRED') },
    fetcher: async () => { calls += 1; return new Response('{}') },
  })
  await expect(service.createConnectOnboarding()).rejects.toThrow('STEP_UP_REQUIRED')
  expect(calls).toBe(0)

  const oversized = createPaymentService({
    functionBaseUrl: 'https://project.supabase.co/functions/v1',
    getAccessToken: async () => 'access-token', requireRecentAal2: () => {},
    fetcher: async () => new Response('x'.repeat(64 * 1024 + 1), { status: 200 }),
  })
  await expect(oversized.refreshConnectStatus()).rejects.toEqual(expect.objectContaining<Partial<PaymentServiceError>>({ reason: 'invalid-response' }))
})

it('rejects untrusted browser destinations even when the payment function returns HTTPS', async () => {
  const service = createPaymentService({
    functionBaseUrl: 'https://project.supabase.co/functions/v1',
    getAccessToken: async () => 'access-token',
    requireRecentAal2: () => {},
    fetcher: async () => new Response(JSON.stringify({
      url: 'https://connect.stripe.com.attacker.example/phish',
      expiresAt: '2026-08-14T20:00:00.000Z',
    }), { status: 200 }),
  })

  await expect(service.createConnectOnboarding()).rejects.toEqual(
    expect.objectContaining<Partial<PaymentServiceError>>({ reason: 'invalid-response' }),
  )
  await expect(service.createPaymentLink('123e4567-e89b-42d3-a456-426614174000')).rejects.toEqual(
    expect.objectContaining<Partial<PaymentServiceError>>({ reason: 'invalid-response' }),
  )
})

it('accepts only the expected Stripe browser destinations for each operation', async () => {
  const service = createPaymentService({
    functionBaseUrl: 'https://project.supabase.co/functions/v1',
    getAccessToken: async () => 'access-token',
    requireRecentAal2: () => {},
    fetcher: async (input) => new Response(JSON.stringify({
      url: String(input).endsWith('/stripe-connect')
        ? 'https://connect.stripe.com/setup/s/acct_123/session'
        : 'https://buy.stripe.com/14k123',
      expiresAt: '2026-08-14T20:00:00.000Z',
    }), { status: 200 }),
  })

  await expect(service.createConnectOnboarding()).resolves.toMatchObject({
    url: 'https://connect.stripe.com/setup/s/acct_123/session',
  })
  await expect(service.createPaymentLink('123e4567-e89b-42d3-a456-426614174000')).resolves.toMatchObject({
    url: 'https://buy.stripe.com/14k123',
  })
})
