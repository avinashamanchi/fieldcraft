import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import {
  evaluateRealtimeLoad,
  evaluateSyncLoad,
  evaluateWebhookLoad,
  FIELDCRAFT_CAPACITY_CONTRACT,
} from './capacity-contracts.mjs'

const directory = fileURLToPath(new URL('.', import.meta.url))
const requireText = async (name, fragments) => {
  const source = await readFile(`${directory}/${name}`, 'utf8')
  for (const fragment of fragments) {
    if (!source.includes(fragment)) throw new Error(`${name} is missing ${fragment}`)
  }
}

await requireText('sync-capacity.js', ['rate: 250', 'rate: 100', "duration: '10m'", 'replayRatio = 0.2'])
await requireText('webhook-capacity.js', ['rate: 25', "duration: '10m'", 'duplicateRatio = 0.2'])
await requireText('realtime-capacity.js', ['vus: 2500', "duration: '30m'"])
await requireText('assert-no-cross-owner.js', ['cross_owner_reads', 'FORBIDDEN_OWNER_SENTINELS'])

const syncPass = evaluateSyncLoad({ pullP95Ms: 749, pullP99Ms: 1499, mutationP95Ms: 999, mutationP99Ms: 1999, unexpectedErrorRate: 0.009, lostAcknowledgements: 0, crossOwnerReads: 0 })
const syncFail = evaluateSyncLoad({ pullP95Ms: 750, pullP99Ms: 1499, mutationP95Ms: 999, mutationP99Ms: 1999, unexpectedErrorRate: 0, lostAcknowledgements: 0, crossOwnerReads: 0 })
const webhookPass = evaluateWebhookLoad({ webhookP95Ms: 999, webhookP99Ms: 1999, unexpectedErrorRate: 0.009, duplicateLedgerWrites: 0, duplicateConversions: 0 })
const realtimePass = evaluateRealtimeLoad({ foregroundSessions: 2500, sustainedSeconds: 1800, unexpectedDisconnectRate: 0.009, crossOwnerReads: 0 })
if (!syncPass.passed || syncFail.passed || !syncFail.reasons.includes('SYNC_PULL_P95') || !webhookPass.passed || !realtimePass.passed) throw new Error('capacity boundary evaluation failed')
if (FIELDCRAFT_CAPACITY_CONTRACT.sync.replayRatio !== 0.2) throw new Error('replay contract changed')
process.stdout.write('FieldCraft load scenario contracts passed. Live staging execution is still required.\n')
