import type { Estimate, Job } from '../../domain/entities'
import { assertEstimateTransition, issueEstimate } from '../../domain/estimates'
import type { MutationEnvelope } from '../../domain/sync'
import { calculateEstimateDraft, type EstimateDraftInput } from './estimateForm'

export type EstimateMutationInput = Readonly<{
  current?: Estimate
  draft: EstimateDraftInput
  estimateId: string
  mutationId: string
  now: string
  ownerId: string
}>

const pendingVersion = (baseVersion: number): number => baseVersion + 1

const wrapEstimate = (
  estimate: Estimate,
  baseVersion: number,
): Estimate & { localEstimate: Estimate } => ({
  ...estimate,
  version: baseVersion,
  localEstimate: { ...estimate, version: pendingVersion(baseVersion) },
})

const estimateMutation = (
  estimate: Estimate,
  mutationId: string,
  createdAt: string,
  baseVersion: number | null,
): MutationEnvelope => ({
  id: mutationId,
  ownerId: estimate.ownerId,
  entity: 'estimate',
  entityId: estimate.id,
  kind: 'save_estimate',
  baseVersion,
  payload: wrapEstimate(estimate, baseVersion ?? 0),
  createdAt,
  attempts: 0,
})

export const buildEstimateMutation = (input: EstimateMutationInput): MutationEnvelope => {
  if (input.current && (input.current.ownerId !== input.ownerId || input.current.id !== input.estimateId)) {
    throw new Error('ESTIMATE_OWNER_MISMATCH')
  }
  if (input.current && input.current.status !== 'Draft') throw new Error('ISSUED_ESTIMATE_IS_IMMUTABLE')
  const calculated = calculateEstimateDraft(input.draft)
  const baseVersion = input.current?.version ?? 0
  const estimate: Estimate = {
    id: input.estimateId,
    ownerId: input.ownerId,
    clientId: calculated.clientId,
    revision: input.current?.revision ?? 1,
    status: 'Draft',
    title: calculated.title,
    scope: calculated.scope,
    lineItems: calculated.lineItems,
    subtotalCents: calculated.subtotalCents,
    taxBasisPoints: calculated.taxBasisPoints,
    taxCents: calculated.taxCents,
    totalCents: calculated.totalCents,
    expiresAt: new Date(calculated.expiresAt).toISOString(),
    ...(calculated.notes?.trim() ? { notes: calculated.notes.trim() } : {}),
    version: baseVersion,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
    syncState: 'pending',
  }
  return estimateMutation(estimate, input.mutationId, input.now, input.current ? baseVersion : null)
}
const estimateNumber = (estimate: Estimate): string => estimate.number ??
  `EST-${estimate.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`

export const buildIssueEstimateMutation = (input: Readonly<{
  estimate: Estimate
  mutationId: string
  issuedAt: string
}>): MutationEnvelope => {
  assertEstimateTransition(input.estimate.status, 'Issued')
  const issued = issueEstimate({
    clientId: input.estimate.clientId,
    title: input.estimate.title,
    scope: input.estimate.scope,
    lineItems: input.estimate.lineItems,
    taxBasisPoints: input.estimate.taxBasisPoints,
    ...(input.estimate.notes === undefined ? {} : { notes: input.estimate.notes }),
  }, {
    number: estimateNumber(input.estimate),
    issuedAt: input.issuedAt,
    expiresAt: input.estimate.expiresAt,
    revision: input.estimate.revision,
  })
  const estimate: Estimate = {
    ...input.estimate,
    ...issued,
    updatedAt: input.issuedAt,
    syncState: 'pending',
  }
  return estimateMutation(estimate, input.mutationId, input.issuedAt, input.estimate.version)
}

export const buildAcceptEstimateMutation = (input: Readonly<{
  estimate: Estimate
  mutationId: string
  acceptedAt: string
}>): MutationEnvelope => {
  assertEstimateTransition(input.estimate.status, 'Accepted')
  const estimate: Estimate = {
    ...input.estimate,
    status: 'Accepted',
    acceptedAt: input.acceptedAt,
    acceptanceRecordedBy: input.estimate.ownerId,
    updatedAt: input.acceptedAt,
    syncState: 'pending',
  }
  return estimateMutation(estimate, input.mutationId, input.acceptedAt, input.estimate.version)
}

export type ConvertEstimatePayload = Readonly<{
  estimateId: string
  jobId: string
  baseVersion: number
  now: string
  estimate: Estimate
  job: Job
}>

export const buildConvertEstimateMutation = (input: Readonly<{
  estimate: Estimate
  mutationId: string
  jobId: string
  now: string
}>): MutationEnvelope => {
  assertEstimateTransition(input.estimate.status, 'Converted')
  if (input.estimate.convertedJobId) throw new Error('INVALID_ESTIMATE_TRANSITION')
  const estimate: Estimate = {
    ...input.estimate,
    status: 'Converted',
    convertedJobId: input.jobId,
    version: pendingVersion(input.estimate.version),
    updatedAt: input.now,
    syncState: 'pending',
  }
  const job: Job = {
    id: input.jobId,
    ownerId: input.estimate.ownerId,
    clientId: input.estimate.clientId,
    title: input.estimate.title,
    description: input.estimate.scope,
    tradeType: 'General',
    status: 'In Progress',
    ...(input.estimate.notes === undefined ? {} : { notes: input.estimate.notes }),
    version: 1,
    createdAt: input.now,
    updatedAt: input.now,
    syncState: 'pending',
  }
  const payload: ConvertEstimatePayload = {
    estimateId: input.estimate.id,
    jobId: input.jobId,
    baseVersion: input.estimate.version,
    now: input.now,
    estimate,
    job,
  }
  return {
    id: input.mutationId,
    ownerId: input.estimate.ownerId,
    entity: 'estimate',
    entityId: input.estimate.id,
    kind: 'convert_estimate',
    baseVersion: input.estimate.version,
    payload,
    createdAt: input.now,
    attempts: 0,
  }
}
