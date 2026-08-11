const finite = (value, name) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`invalid ${name}`)
  return value
}

export const FIELDCRAFT_CAPACITY_CONTRACT = Object.freeze({
  sync: Object.freeze({ pullRps: 250, mutationRps: 100, durationSeconds: 600, replayRatio: 0.2 }),
  webhook: Object.freeze({ rps: 25, durationSeconds: 600, duplicateRatio: 0.2 }),
  realtime: Object.freeze({ foregroundSessions: 2500, durationSeconds: 1800 }),
  thresholdsMs: Object.freeze({ pullP95: 750, pullP99: 1500, mutationP95: 1000, mutationP99: 2000, webhookP95: 1000, webhookP99: 2000 }),
  maximumUnexpectedErrorRate: 0.01,
})

const result = (failures) => Object.freeze({
  passed: failures.length === 0,
  ...(failures.length === 0 ? {} : { reasons: Object.freeze(failures) }),
})

export const evaluateSyncLoad = (sample) => {
  const failures = []
  if (finite(sample.pullP95Ms, 'pullP95Ms') >= 750) failures.push('SYNC_PULL_P95')
  if (finite(sample.pullP99Ms, 'pullP99Ms') >= 1500) failures.push('SYNC_PULL_P99')
  if (finite(sample.mutationP95Ms, 'mutationP95Ms') >= 1000) failures.push('SYNC_MUTATION_P95')
  if (finite(sample.mutationP99Ms, 'mutationP99Ms') >= 2000) failures.push('SYNC_MUTATION_P99')
  if (finite(sample.unexpectedErrorRate, 'unexpectedErrorRate') >= 0.01) failures.push('UNEXPECTED_ERROR_RATE')
  if (finite(sample.lostAcknowledgements, 'lostAcknowledgements') !== 0) failures.push('LOST_ACK')
  if (finite(sample.crossOwnerReads, 'crossOwnerReads') !== 0) failures.push('CROSS_OWNER_READ')
  return result(failures)
}

export const evaluateWebhookLoad = (sample) => {
  const failures = []
  if (finite(sample.webhookP95Ms, 'webhookP95Ms') >= 1000) failures.push('WEBHOOK_P95')
  if (finite(sample.webhookP99Ms, 'webhookP99Ms') >= 2000) failures.push('WEBHOOK_P99')
  if (finite(sample.unexpectedErrorRate, 'unexpectedErrorRate') >= 0.01) failures.push('UNEXPECTED_ERROR_RATE')
  if (finite(sample.duplicateLedgerWrites, 'duplicateLedgerWrites') !== 0) failures.push('DUPLICATE_LEDGER')
  if (finite(sample.duplicateConversions, 'duplicateConversions') !== 0) failures.push('DUPLICATE_CONVERSION')
  return result(failures)
}

export const evaluateRealtimeLoad = (sample) => {
  const failures = []
  if (finite(sample.foregroundSessions, 'foregroundSessions') < 2500) failures.push('REALTIME_SESSIONS')
  if (finite(sample.sustainedSeconds, 'sustainedSeconds') < 1800) failures.push('REALTIME_DURATION')
  if (finite(sample.crossOwnerReads, 'crossOwnerReads') !== 0) failures.push('CROSS_OWNER_READ')
  if (finite(sample.unexpectedDisconnectRate, 'unexpectedDisconnectRate') >= 0.01) failures.push('REALTIME_DISCONNECT_RATE')
  return result(failures)
}
