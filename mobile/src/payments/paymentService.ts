import { z } from 'zod'

import { getSupabaseClient } from '../auth/supabase'
import { requireRecentAal2 } from '../auth/requireAal2'
import { validateSupabaseFunctionUrl } from '../network/supabaseFunctionUrl'

export type ConnectStatus = Readonly<{
  state: 'not-connected' | 'pending' | 'restricted' | 'complete'
  chargesEnabled: boolean
  payoutsEnabled: boolean
}>

export interface PaymentService {
  createConnectOnboarding(): Promise<{ url: string; expiresAt: string }>
  refreshConnectStatus(): Promise<ConnectStatus>
  disconnectConnect(): Promise<void>
  createPaymentLink(invoiceId: string): Promise<{ url: string; expiresAt: string }>
  revokePaymentLink(invoiceId: string): Promise<void>
}

export type PaymentServiceErrorReason = 'reauthentication' | 'invalid-response' | 'timeout' | 'transient'
export class PaymentServiceError extends Error {
  constructor(readonly reason: PaymentServiceErrorReason) {
    super('FieldCraft could not complete the payment request.')
    this.name = 'PaymentServiceError'
  }
}

type Options = Readonly<{
  functionBaseUrl: string
  getAccessToken(): Promise<string | null>
  requireRecentAal2(): void
  fetcher?: typeof fetch
  deadlineMs?: number
}>

const trustedStripeUrl = (allowedHosts: readonly string[]) => z.url().refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && allowedHosts.includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
})
const ConnectUrlSchema = z.object({
  url: trustedStripeUrl(['connect.stripe.com']),
  expiresAt: z.iso.datetime(),
}).passthrough()
const PaymentUrlSchema = z.object({
  url: trustedStripeUrl(['buy.stripe.com', 'checkout.stripe.com']),
  expiresAt: z.iso.datetime(),
}).passthrough()
const StatusSchema = z.object({ state: z.enum(['not-connected', 'pending', 'restricted', 'complete']), chargesEnabled: z.boolean(), payoutsEnabled: z.boolean() }).passthrough()
const SuccessSchema = z.object({ status: z.string().min(1) }).passthrough()
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const validateEndpointUrl = (baseUrl: string, functionName: 'stripe-connect' | 'payment-link'): string => {
  return validateSupabaseFunctionUrl(
    `${baseUrl.replace(/\/$/, '')}/${functionName}`,
    functionName,
    'Payment functions require an HTTPS Supabase URL.',
  )
}

const readBounded = async (response: Response, signal: AbortSignal): Promise<string> => {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new PaymentServiceError('timeout')), { once: true })),
    ])
    if (next.done) break
    total += next.value.byteLength
    if (total > 64 * 1024) { await reader.cancel(); throw new PaymentServiceError('invalid-response') }
    chunks.push(next.value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(joined) } catch { throw new PaymentServiceError('invalid-response') }
}

export const createPaymentService = (options: Options): PaymentService => {
  const endpointUrls = {
    'stripe-connect': validateEndpointUrl(options.functionBaseUrl, 'stripe-connect'),
    'payment-link': validateEndpointUrl(options.functionBaseUrl, 'payment-link'),
  } as const
  const call = async <T>(route: 'stripe-connect' | 'payment-link', body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => {
    options.requireRecentAal2()
    const accessToken = await options.getAccessToken()
    if (!accessToken) throw new PaymentServiceError('reauthentication')
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, options.deadlineMs ?? 10_000)
    try {
      const response = await (options.fetcher ?? fetch)(endpointUrls[route], {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await readBounded(response, controller.signal)
      if (response.status === 401 || response.status === 403) throw new PaymentServiceError('reauthentication')
      if (!response.ok) throw new PaymentServiceError('transient')
      let parsed: unknown
      try { parsed = JSON.parse(text) } catch { throw new PaymentServiceError('invalid-response') }
      const result = schema.safeParse(parsed)
      if (!result.success) throw new PaymentServiceError('invalid-response')
      return result.data
    } catch (cause) {
      if (cause instanceof PaymentServiceError) throw cause
      throw new PaymentServiceError(timedOut ? 'timeout' : 'transient')
    } finally { clearTimeout(timer) }
  }
  return {
    createConnectOnboarding: () => call('stripe-connect', { action: 'onboard' }, ConnectUrlSchema),
    refreshConnectStatus: () => call('stripe-connect', { action: 'status' }, StatusSchema),
    async disconnectConnect() { await call('stripe-connect', { action: 'disconnect' }, SuccessSchema) },
    createPaymentLink(invoiceId) {
      if (!uuidPattern.test(invoiceId)) return Promise.reject(new PaymentServiceError('invalid-response'))
      return call('payment-link', { action: 'issue', invoiceId }, PaymentUrlSchema)
    },
    async revokePaymentLink(invoiceId) {
      if (!uuidPattern.test(invoiceId)) throw new PaymentServiceError('invalid-response')
      await call('payment-link', { action: 'revoke', invoiceId }, SuccessSchema)
    },
  }
}

export const getPaymentService = (): PaymentService => createPaymentService({
  functionBaseUrl: `${process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? ''}/functions/v1`,
  async getAccessToken() {
    const { data, error } = await getSupabaseClient().auth.getSession()
    return error ? null : data.session?.access_token ?? null
  },
  requireRecentAal2: () => { requireRecentAal2('payment-link') },
})
