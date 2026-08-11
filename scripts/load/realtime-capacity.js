import ws from 'k6/ws'
import { check } from 'k6'
import { Counter, Rate } from 'k6/metrics'

const crossOwnerReads = new Counter('cross_owner_reads')
const unexpectedDisconnects = new Rate('unexpected_disconnects')

export const options = {
  scenarios: { foreground: { executor: 'constant-vus', vus: 2500, duration: '30m' } },
  thresholds: { cross_owner_reads: ['count==0'], unexpected_disconnects: ['rate<0.01'] },
}

export function setup() {
  const urls = JSON.parse(__ENV.REALTIME_OWNER_URLS || '[]')
  const forbidden = JSON.parse(__ENV.FORBIDDEN_OWNER_SENTINELS || '[]')
  if (urls.length < 2 || urls.length !== forbidden.length || urls.some((value) => !value.startsWith('wss://'))) throw new Error('owner-scoped WSS fixtures are required')
  return { urls, forbidden }
}
export default function (data) {
  const index = (__VU - 1) % data.urls.length
  const response = ws.connect(data.urls[index], {}, (socket) => {
    let closedNormally = false
    socket.on('message', (message) => {
      if (data.forbidden.some((sentinel, candidate) => candidate !== index && String(message).includes(sentinel))) crossOwnerReads.add(1)
    })
    socket.setTimeout(() => { closedNormally = true; socket.close() }, 30 * 60 * 1000 - 1000)
    socket.on('close', () => unexpectedDisconnects.add(!closedNormally))
  })
  check(response, { 'realtime upgrade accepted': (result) => result && result.status === 101 })
}
