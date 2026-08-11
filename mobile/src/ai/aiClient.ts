import { getSupabaseClient } from '../auth/supabase'
import { validateSupabaseFunctionUrl } from '../network/supabaseFunctionUrl'
import { aiConsentStore, type AiConsentStore } from './consentStore'
import { AiRequestSchema, parseAiResponse, type AiRequest, type AiResultFor } from './contracts'

const MAX_RESPONSE_BYTES = 128 * 1024
const DEFAULT_DEADLINE_MS = 20_000

export type AiClientErrorReason =
  | 'cancelled'
  | 'consent-required'
  | 'invalid-response'
  | 'rate-limited'
  | 'reauthentication'
  | 'timeout'
  | 'transient'
  | 'validation'

export class AiClientError extends Error {
  constructor(readonly reason: AiClientErrorReason, readonly retryAfterSeconds?: number) {
    super('FieldCraft AI could not complete the request.')
    this.name = 'AiClientError'
  }
}

type AiClientOptions = {
  consent?: Pick<AiConsentStore, 'hasConsent'>
  deadlineMs?: number
  fetcher?: typeof fetch
  functionUrl?: string
  getAccessToken?: () => Promise<string | null>
}

const configuredFunctionUrl = (): string => {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '') ?? ''
  return `${base}/functions/v1/fieldcraft-ai`
}

const validateFunctionUrl = (value: string): string => {
  return validateSupabaseFunctionUrl(value, 'fieldcraft-ai', 'FieldCraft AI requires a trusted HTTPS function URL')
}

const defaultAccessToken = async (): Promise<string | null> => {
  const { data, error } = await getSupabaseClient().auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}

const readBoundedText = async (response: Response): Promise<string> => {
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new AiClientError('invalid-response')
      }
      chunks.push(value)
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    return new TextDecoder().decode(body)
  }
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new AiClientError('invalid-response')
  }
  return text
}

export const createAiClient = (options: AiClientOptions = {}) => {
  const functionUrl = validateFunctionUrl(options.functionUrl ?? configuredFunctionUrl())
  const fetcher = options.fetcher ?? fetch
  const consent = options.consent ?? aiConsentStore
  const getAccessToken = options.getAccessToken ?? defaultAccessToken
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS

  return {
    async request<T extends AiRequest>(ownerId: string, rawRequest: T, externalSignal?: AbortSignal): Promise<AiResultFor<T['route']>> {
      let request: AiRequest
      try { request = AiRequestSchema.parse(rawRequest) } catch { throw new AiClientError('validation') }
      if (!await consent.hasConsent(ownerId)) throw new AiClientError('consent-required')
      const token = await getAccessToken()
      if (!token) throw new AiClientError('reauthentication')

      const controller = new AbortController()
      let timedOut = false
      const abort = () => controller.abort()
      if (externalSignal?.aborted) throw new AiClientError('cancelled')
      externalSignal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, deadlineMs)
      try {
        const response = await fetcher(functionUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        })
        const body = await Promise.race([
          readBoundedText(response),
          new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => {
            reject(new AiClientError(timedOut ? 'timeout' : 'cancelled'))
          }, { once: true })),
        ])
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new AiClientError('reauthentication')
          if (response.status === 429) {
            let retryAfterSeconds: number | undefined
            try {
              const parsed = JSON.parse(body) as { retryAfterSeconds?: unknown }
              if (Number.isSafeInteger(parsed.retryAfterSeconds) && Number(parsed.retryAfterSeconds) >= 0) retryAfterSeconds = Number(parsed.retryAfterSeconds)
            } catch { /* public body is intentionally ignored */ }
            throw new AiClientError('rate-limited', retryAfterSeconds)
          }
          if (response.status >= 500) throw new AiClientError('transient')
          throw new AiClientError('validation')
        }
        let parsed: unknown
        try { parsed = JSON.parse(body) } catch { throw new AiClientError('invalid-response') }
        try { return parseAiResponse(request.route, parsed) as AiResultFor<T['route']> } catch { throw new AiClientError('invalid-response') }
      } catch (cause) {
        if (cause instanceof AiClientError) throw cause
        if (timedOut) throw new AiClientError('timeout')
        if (externalSignal?.aborted || controller.signal.aborted) throw new AiClientError('cancelled')
        throw new AiClientError('transient')
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', abort)
      }
    },
  }
}

let configuredAiClient: ReturnType<typeof createAiClient> | null = null
export const getAiClient = () => {
  configuredAiClient ??= createAiClient()
  return configuredAiClient
}
