import { createPaymentService, PaymentServiceError } from '../src/payments/paymentService'

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
