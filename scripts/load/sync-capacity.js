import http from 'k6/http'
import { check } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const pullLatency = new Trend('sync_pull_latency', true)
const mutationLatency = new Trend('sync_mutation_latency', true)
const unexpectedErrors = new Rate('unexpected_errors')
const lostAcknowledgements = new Counter('lost_acknowledgements')
const crossOwnerReads = new Counter('cross_owner_reads')
const replayRatio = 0.2

export const options = {
  scenarios: {
    pulls: { executor: 'constant-arrival-rate', exec: 'pull', rate: 250, timeUnit: '1s', duration: '10m', preAllocatedVUs: 250, maxVUs: 1000 },
    mutations: { executor: 'constant-arrival-rate', exec: 'mutate', rate: 100, timeUnit: '1s', duration: '10m', preAllocatedVUs: 100, maxVUs: 500 },
  },
  thresholds: {
    sync_pull_latency: ['p(95)<750', 'p(99)<1500'],
    sync_mutation_latency: ['p(95)<1000', 'p(99)<2000'],
    unexpected_errors: ['rate<0.01'],
    lost_acknowledgements: ['count==0'],
    cross_owner_reads: ['count==0'],
  },
}

const requiredJson = (name) => {
  if (!__ENV[name]) throw new Error(`${name} is required`)
  return JSON.parse(__ENV[name])
}
const baseUrl = () => {
  const value = new URL(__ENV.STAGING_SUPABASE_URL)
  if (value.protocol !== 'https:') throw new Error('STAGING_SUPABASE_URL must use HTTPS')
  return value.toString().replace(/\/$/, '')
}
const fixture = () => {
  const tokens = requiredJson('STAGING_ACCESS_TOKENS')
  const bodies = requiredJson('SYNC_MUTATION_BODIES')
  const forbidden = requiredJson('FORBIDDEN_OWNER_SENTINELS')
  if (!Array.isArray(tokens) || tokens.length < 2 || tokens.length !== bodies.length || tokens.length !== forbidden.length) throw new Error('synthetic owner fixtures are incomplete')
  return { tokens, bodies, forbidden }
}
const ownerIndex = (length) => (__VU - 1) % length
const headers = (token) => ({ Authorization: `Bearer ${token}`, apikey: __ENV.STAGING_PUBLIC_KEY, 'Content-Type': 'application/json' })

export function setup() { baseUrl(); return fixture() }

export function pull(data) {
  const index = ownerIndex(data.tokens.length)
  const response = http.post(`${baseUrl()}/rest/v1/rpc/pull_sync_changes`, JSON.stringify({ p_cursor_change_seq: 0, p_limit: 200 }), { headers: headers(data.tokens[index]), tags: { route: 'pull' } })
  pullLatency.add(response.timings.duration)
  const expected = check(response, { 'pull is bounded success': (result) => result.status === 200 && result.body.length <= 262144 })
  unexpectedErrors.add(!expected)
  if (data.forbidden.some((sentinel, candidate) => candidate !== index && response.body.includes(sentinel))) crossOwnerReads.add(1)
}

export function mutate(data) {
  const index = ownerIndex(data.tokens.length)
  const body = data.bodies[index]
  const replay = Math.random() < replayRatio
  const mutationId = `${__VU.toString(16).padStart(8, '0')}-${(__ITER % 65536).toString(16).padStart(4, '0')}-4000-8000-${(__ITER + __VU).toString().padStart(12, '0').slice(-12)}`
  const response = http.post(`${baseUrl()}/rest/v1/rpc/apply_entity_mutation`, JSON.stringify(replay ? body : { ...body, p_mutation_id: mutationId }), { headers: headers(data.tokens[index]), tags: { route: replay ? 'mutation-replay' : 'mutation' } })
  mutationLatency.add(response.timings.duration)
  const expected = check(response, { 'mutation acknowledged': (result) => result.status === 200 && /"status"\s*:\s*"(applied|conflict)"/.test(result.body) })
  unexpectedErrors.add(!expected)
  if (response.status === 200 && !response.body.includes('mutation_id')) lostAcknowledgements.add(1)
}
