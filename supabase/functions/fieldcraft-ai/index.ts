import { authenticate } from '../_shared/auth.ts'
import { readBoundedBody } from '../_shared/body.ts'
import { parseAiRequest, type AiRequest, type AiRoute } from '../_shared/contracts.ts'
import { callProvider } from '../_shared/provider.ts'
import { consumeRateLimit, digestScope } from '../_shared/rateLimit.ts'

const ROUTE_LIMITS: Record<AiRoute, number> = {
  'invoice.parse.v1': 10,
  'expense.categorize.v1': 30,
  'message.draft.v1': 30,
}
const MAX_REQUEST_BYTES = 64 * 1024

type HandlerDependencies = {
  authenticateRequest: (authorization: string | null) => Promise<{ userId: string }>
  consume: (scopeDigest: string, route: AiRoute, limit: number) => Promise<{ allowed: boolean; retryAfterSeconds: number }>
  digest: (value: string) => Promise<string>
  invokeProvider: (request: AiRequest) => Promise<Record<string, unknown>>
  log: (entry: Record<string, unknown>) => void
  allowedOrigins: Set<string>
}

const json = (status: number, body: Record<string, unknown>, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
})

const corsHeaders = (request: Request, allowedOrigins: Set<string>): Record<string, string> => {
  const origin = request.headers.get('origin')
  return origin && allowedOrigins.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  } : {}
}

export const createHandler = (dependencies: HandlerDependencies) => async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID()
  const started = Date.now()
  const cors = corsHeaders(request, dependencies.allowedOrigins)
  let route: AiRoute | undefined
  let userDigest: string | undefined
  let networkDigest: string | undefined
  let publicCode = 'ok'
  let status = 200
  try {
    if (request.method === 'OPTIONS') { status = 204; return new Response(null, { status, headers: cors }) }
    if (request.method !== 'POST') { status = 405; publicCode = 'method-not-allowed'; return json(status, { error: publicCode, requestId }, cors) }

    const identity = await dependencies.authenticateRequest(request.headers.get('authorization'))
    userDigest = await dependencies.digest(`user:${identity.userId}`)
    const rawAddress = (request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim().slice(0, 128)
    networkDigest = await dependencies.digest(`network:${rawAddress}`)
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) throw new Error('body-too-large')
    let raw: unknown
    try { raw = JSON.parse(await readBoundedBody(request, MAX_REQUEST_BYTES)) } catch (cause) {
      if (cause instanceof Error && cause.message === 'body-too-large') throw cause
      throw new Error('invalid-request')
    }
    const parsed = parseAiRequest(raw)
    route = parsed.route
    const limit = ROUTE_LIMITS[route]
    const [userRate, networkRate] = await Promise.all([
      dependencies.consume(userDigest, route, limit),
      dependencies.consume(networkDigest, route, limit),
    ])
    if (!userRate.allowed || !networkRate.allowed) {
      status = 429
      publicCode = 'rate-limited'
      const retryAfterSeconds = Math.max(userRate.retryAfterSeconds, networkRate.retryAfterSeconds)
      return json(status, { error: publicCode, requestId, retryAfterSeconds }, { ...cors, 'Retry-After': String(retryAfterSeconds) })
    }
    const result = await dependencies.invokeProvider(parsed)
    return json(200, { route, version: 1, result }, cors)
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : 'internal-error'
    if (code === 'unauthorized') { status = 401; publicCode = 'unauthorized' }
    else if (code === 'body-too-large') { status = 413; publicCode = 'request-too-large' }
    else if (code === 'invalid-request') { status = 400; publicCode = 'invalid-request' }
    else if (code === 'provider-timeout') { status = 504; publicCode = 'upstream-timeout' }
    else if (code === 'invalid-provider-response') { status = 502; publicCode = 'invalid-upstream-response' }
    else { status = 503; publicCode = 'temporarily-unavailable' }
    return json(status, { error: publicCode, requestId }, cors)
  } finally {
    const latency = Date.now() - started
    dependencies.log({
      requestId, route: route ?? 'unparsed', userDigest: userDigest ?? 'unavailable',
      networkDigest: networkDigest ?? 'unavailable', status, publicCode,
      latencyBucket: latency < 100 ? '<100ms' : latency < 1000 ? '<1s' : latency < 10_000 ? '<10s' : '>=10s',
    })
  }
}

const requireEnvironment = (environment: Record<string, string>, key: string): string => {
  const value = environment[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

export const createProductionHandler = (environment: Record<string, string>) => {
  const supabaseUrl = requireEnvironment(environment, 'SUPABASE_URL')
  const hmacSecret = requireEnvironment(environment, 'AI_RATE_LIMIT_HMAC_SECRET')
  const publishableKey = environment.SUPABASE_ANON_KEY?.trim() || requireEnvironment(environment, 'SUPABASE_PUBLISHABLE_KEY')
  const serviceRoleKey = requireEnvironment(environment, 'SUPABASE_SERVICE_ROLE_KEY')
  const providerKey = requireEnvironment(environment, 'AI_PROVIDER_API_KEY')
  return createHandler({
    allowedOrigins: new Set((environment.AI_ALLOWED_ORIGINS ?? 'https://avinashamanchi.github.io').split(',').map((value) => value.trim()).filter(Boolean)),
    authenticateRequest: (authorization) => authenticate(authorization, { supabaseUrl, publishableKey }),
    consume: (scope, route, limit) => consumeRateLimit(scope, route, limit, { supabaseUrl, serviceRoleKey }),
    digest: (value) => digestScope(hmacSecret, value),
    invokeProvider: (request) => callProvider(request, {
      apiKey: providerKey,
      endpoint: environment.AI_PROVIDER_URL ?? 'https://api.groq.com/openai/v1/chat/completions',
      model: environment.AI_PROVIDER_MODEL ?? 'llama-3.3-70b-versatile',
    }),
    log: (entry) => console.info(JSON.stringify(entry)),
  })
}

if (import.meta.main) Deno.serve(createProductionHandler(Deno.env.toObject()))
