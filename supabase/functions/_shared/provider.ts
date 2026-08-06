import { readBoundedBody } from './body.ts'
import { parseProviderResult, type AiRequest } from './contracts.ts'

const promptFor = (request: AiRequest): string => {
  if (request.route === 'invoice.parse.v1') return `Extract one invoice draft from this transcript. Return only JSON matching the requested schema. Input: ${JSON.stringify({ transcript: request.transcript, defaults: request.defaults })}`
  if (request.route === 'expense.categorize.v1') return `Choose one expense category from Materials, Fuel, Equipment, Subcontractor, Other. Return only JSON. Input: ${JSON.stringify({ vendor: request.vendor, amountCents: request.amountCents, notes: request.notes })}`
  return `Draft a concise customer message. Return only JSON with a message field. Input: ${JSON.stringify({ tone: request.tone, context: request.context })}`
}

export const callProvider = async (
  request: AiRequest,
  configuration: { apiKey: string; endpoint: string; model: string; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<Record<string, unknown>> => {
  const controller = new AbortController()
  const timeout = configuration.timeoutMs ?? (request.route === 'invoice.parse.v1' ? 20_000 : 10_000)
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await (configuration.fetcher ?? fetch)(configuration.endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${configuration.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: configuration.model,
        messages: [{ role: 'system', content: 'Return only strict JSON. Do not repeat secrets or unrelated data.' }, { role: 'user', content: promptFor(request) }],
        temperature: 0.2,
        max_completion_tokens: request.route === 'invoice.parse.v1' ? 1800 : 500,
      }),
    })
    if (!response.ok) throw new Error('provider-unavailable')
    let outer: { choices?: { message?: { content?: unknown } }[] }
    try { outer = JSON.parse(await readBoundedBody(response, 128 * 1024)) } catch { throw new Error('invalid-provider-response') }
    const content = outer?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || new TextEncoder().encode(content).byteLength > 128 * 1024) throw new Error('invalid-provider-response')
    try { return parseProviderResult(request.route, JSON.parse(content)) } catch { throw new Error('invalid-provider-response') }
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('provider-timeout')
    throw cause
  } finally {
    clearTimeout(timer)
  }
}
