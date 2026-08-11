import { z } from 'zod'

import type { Job, JobStatus } from '../../domain/entities'
import { MAX_MONEY_CENTS, MAX_QUANTITY_THOUSANDTHS } from '../../domain/limits'
import type { MutationEnvelope } from '../../domain/sync'
import { codePointLength, literalSearch, recordMutation, type MutationBuildInput } from '../recordMutation'

const boundedText = (maximum: number, label: string) => z.string().trim().refine(
  (value) => codePointLength(value) <= maximum,
  `${label} must contain at most ${maximum} characters`,
)

export const JobDraftSchema = z.object({
  clientId: z.string().min(1, 'Choose a client'),
  title: boundedText(200, 'Title').pipe(z.string().min(1, 'Enter a job title')),
  tradeType: z.enum(['Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting']),
  status: z.enum(['Scheduled', 'In Progress', 'Invoiced', 'Paid']),
  address: boundedText(500, 'Address'),
  description: boundedText(4000, 'Description'),
  laborHoursThousandths: z.number().finite().int().min(0).max(MAX_QUANTITY_THOUSANDTHS),
  laborRateCents: z.number().finite().int().min(0).max(MAX_MONEY_CENTS),
  notes: boundedText(4000, 'Notes'),
}).strict()

export type JobDraft = z.infer<typeof JobDraftSchema>

export const buildJobMutation = (
  input: MutationBuildInput<Job> & { draft: JobDraft },
): MutationEnvelope => {
  if (input.current && input.current.ownerId !== input.ownerId) throw new Error('Job owner changed')
  const draft = JobDraftSchema.parse(input.draft)
  const payload: Job = {
    id: input.entityId,
    ownerId: input.ownerId,
    clientId: draft.clientId,
    title: draft.title,
    tradeType: draft.tradeType,
    status: draft.status,
    ...(draft.address ? { address: draft.address } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    laborHoursThousandths: draft.laborHoursThousandths,
    laborRateCents: draft.laborRateCents,
    ...(draft.notes ? { notes: draft.notes } : {}),
    version: input.current?.version ?? 1,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
    syncState: 'pending',
  }
  return recordMutation('job', input, payload)
}

export const filterJobs = (jobs: Job[], query: string, status: JobStatus | 'All'): Job[] => jobs.filter(
  (job) => (status === 'All' || job.status === status) && literalSearch(job.title, query),
)
