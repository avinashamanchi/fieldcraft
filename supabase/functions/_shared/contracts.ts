export const AI_CONSENT_VERSION = '2026-08-03' as const
export type AiRoute = 'invoice.parse.v1' | 'expense.categorize.v1' | 'message.draft.v1'
export type AiRequest = Record<string, unknown> & { route: AiRoute; consentVersion: typeof AI_CONSENT_VERSION }

const routes = new Set<AiRoute>(['invoice.parse.v1', 'expense.categorize.v1', 'message.draft.v1'])
const trades = new Set(['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting'])
const tones = new Set(['Casual', 'Professional', 'Firm'])
const categories = new Set(['Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other'])
const paymentTerms = new Set(['Due on receipt', 'Net 14', 'Net 30'])
const exactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}
const text = (value: unknown, min: number, max: number) => typeof value === 'string' && Array.from(value).length >= min && Array.from(value).length <= max
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export const parseAiRequest = (value: unknown): AiRequest => {
  if (!object(value) || !routes.has(value.route as AiRoute) || value.consentVersion !== AI_CONSENT_VERSION) throw new Error('invalid-request')
  if (value.route === 'invoice.parse.v1') {
    if (!exactKeys(value, ['route', 'consentVersion', 'transcript', 'defaults']) || !text(value.transcript, 1, 20_000) || !object(value.defaults) ||
      !exactKeys(value.defaults, ['tradeType', 'hourlyRateCents', 'taxBasisPoints']) || !trades.has(String(value.defaults.tradeType)) ||
      !integer(value.defaults.hourlyRateCents, 0, 100_000_000) || !integer(value.defaults.taxBasisPoints, 0, 10_000)) throw new Error('invalid-request')
  } else if (value.route === 'expense.categorize.v1') {
    if (!exactKeys(value, ['route', 'consentVersion', 'vendor', 'amountCents', 'notes']) || !text(value.vendor, 1, 200) ||
      !integer(value.amountCents, 0, 100_000_000) || !text(value.notes, 0, 4000)) throw new Error('invalid-request')
  } else if (!exactKeys(value, ['route', 'consentVersion', 'tone', 'context']) || !tones.has(String(value.tone)) || !text(value.context, 1, 20_000)) {
    throw new Error('invalid-request')
  }
  return value as AiRequest
}

export const parseProviderResult = (route: AiRoute, value: unknown): Record<string, unknown> => {
  if (!object(value)) throw new Error('invalid-provider-response')
  if (route === 'expense.categorize.v1') {
    if (!exactKeys(value, ['category']) || !categories.has(String(value.category))) throw new Error('invalid-provider-response')
  } else if (route === 'message.draft.v1') {
    if (!exactKeys(value, ['message']) || !text(value.message, 1, 4000)) throw new Error('invalid-provider-response')
  } else {
    const keys = ['clientName', 'jobTitle', 'jobAddress', 'jobDescription', 'tradeType', 'taxBasisPoints', 'paymentTerms', 'lineItems', 'notes']
    const required = ['clientName', 'jobTitle', 'tradeType', 'taxBasisPoints', 'paymentTerms', 'lineItems']
    if (Object.keys(value).some((key) => !keys.includes(key)) || required.some((key) => !(key in value)) ||
      !text(value.clientName, 1, 200) || !text(value.jobTitle, 1, 200) || !trades.has(String(value.tradeType)) ||
      !integer(value.taxBasisPoints, 0, 10_000) || !paymentTerms.has(String(value.paymentTerms)) || !Array.isArray(value.lineItems) ||
      value.lineItems.length < 1 || value.lineItems.length > 100) throw new Error('invalid-provider-response')
    for (const line of value.lineItems) {
      if (!object(line) || !exactKeys(line, ['description', 'type', 'quantity', 'unitPriceCents']) || !text(line.description, 1, 500) ||
        !['labor', 'material'].includes(String(line.type)) || !integer(line.quantity, 0, 10_000) || !integer(line.unitPriceCents, 0, 100_000_000)) throw new Error('invalid-provider-response')
    }
    if (value.jobAddress !== undefined && !text(value.jobAddress, 0, 500)) throw new Error('invalid-provider-response')
    if (value.jobDescription !== undefined && !text(value.jobDescription, 0, 4000)) throw new Error('invalid-provider-response')
    if (value.notes !== undefined && !text(value.notes, 0, 4000)) throw new Error('invalid-provider-response')
  }
  return value
}
