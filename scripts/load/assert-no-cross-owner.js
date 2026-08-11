import http from 'k6/http'
import { check } from 'k6'
import { Counter } from 'k6/metrics'

const crossOwnerReads = new Counter('cross_owner_reads')
export const options = { vus: 10, iterations: 100, thresholds: { cross_owner_reads: ['count==0'], checks: ['rate==1'] } }

export function setup() {
  const tokens = JSON.parse(__ENV.STAGING_ACCESS_TOKENS || '[]')
  const sentinels = JSON.parse(__ENV.FORBIDDEN_OWNER_SENTINELS || '[]')
  if (tokens.length < 2 || tokens.length !== sentinels.length) throw new Error('FORBIDDEN_OWNER_SENTINELS must match synthetic access tokens')
  return { tokens, sentinels }
}
export default function (data) {
  const index = (__ITER + __VU) % data.tokens.length
  const response = http.post(`${__ENV.STAGING_SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/pull_sync_changes`, JSON.stringify({ p_cursor_change_seq: 0, p_limit: 200 }), { headers: { Authorization: `Bearer ${data.tokens[index]}`, apikey: __ENV.STAGING_PUBLIC_KEY, 'Content-Type': 'application/json' } })
  const isolated = !data.sentinels.some((sentinel, candidate) => candidate !== index && response.body.includes(sentinel))
  if (!isolated) crossOwnerReads.add(1)
  check(response, { 'owner response is isolated': () => response.status === 200 && isolated })
}
