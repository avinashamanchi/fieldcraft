export type OperationalEvent = Readonly<{
  requestId?: string
  route?: string
  deployment?: string
  provider?: string
  environment?: string
  status?: string
  reason?: string
  latencyBucket?: '<100ms' | '<1s' | '<10s' | '>=10s'
}>

const allowed = new Set<keyof OperationalEvent>([
  'requestId', 'route', 'deployment', 'provider', 'environment',
  'status', 'reason', 'latencyBucket',
])
const safeValue = /^[A-Za-z0-9._:-]{1,80}$/

export const redactEvent = (input: Record<string, unknown>): OperationalEvent => {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key as keyof OperationalEvent) || typeof value !== 'string') continue
    if (key === 'requestId') {
      if (/^[0-9a-f-]{36}$/i.test(value)) result[key] = value
    } else if (key === 'latencyBucket') {
      if (['<100ms', '<1s', '<10s', '>=10s'].includes(value)) result[key] = value
    } else if (safeValue.test(value)) result[key] = value
  }
  return Object.freeze(result)
}
