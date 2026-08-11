import crypto from 'k6/crypto'
import http from 'k6/http'
import { check } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const webhookLatency = new Trend('webhook_latency', true)
const unexpectedErrors = new Rate('unexpected_errors')
const duplicateLedgerWrites = new Counter('duplicate_ledger_writes')
const duplicateConversions = new Counter('duplicate_conversions')
const duplicateRatio = 0.2

export const options = {
  scenarios: { webhooks: { executor: 'constant-arrival-rate', rate: 25, timeUnit: '1s', duration: '10m', preAllocatedVUs: 50, maxVUs: 250 } },
  thresholds: { webhook_latency: ['p(95)<1000', 'p(99)<2000'], unexpected_errors: ['rate<0.01'], duplicate_ledger_writes: ['count==0'], duplicate_conversions: ['count==0'] },
}

const endpoint = () => {
  const url = new URL(__ENV.STAGING_STRIPE_WEBHOOK_URL)
  if (url.protocol !== 'https:') throw new Error('STAGING_STRIPE_WEBHOOK_URL must use HTTPS')
  return url.toString()
}
export function setup() {
  const bodies = JSON.parse(__ENV.STRIPE_WEBHOOK_BODIES || '[]')
  if (!__ENV.STRIPE_WEBHOOK_SECRET || !Array.isArray(bodies) || bodies.length < 5) throw new Error('signed synthetic webhook fixtures are required')
  endpoint()
  return bodies
}
const signature = (body) => {
  const timestamp = Math.floor(Date.now() / 1000)
  return `t=${timestamp},v1=${crypto.hmac('sha256', __ENV.STRIPE_WEBHOOK_SECRET, `${timestamp}.${body}`, 'hex')}`
}
export default function (bodies) {
  const source = bodies[(__ITER + __VU) % bodies.length]
  const body = Math.random() < duplicateRatio ? bodies[0] : source
  const response = http.post(endpoint(), body, { headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature(body) } })
  webhookLatency.add(response.timings.duration)
  const accepted = check(response, { 'webhook is applied duplicate or stale': (result) => result.status === 200 && /"outcome"\s*:\s*"(applied|duplicate|stale)"/.test(result.body) })
  unexpectedErrors.add(!accepted)
  if (response.body.includes('duplicate-ledger-write')) duplicateLedgerWrites.add(1)
  if (response.body.includes('duplicate-conversion')) duplicateConversions.add(1)
}
