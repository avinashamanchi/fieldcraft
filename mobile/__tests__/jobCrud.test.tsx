import { buildJobMutation, filterJobs, JobDraftSchema } from '../src/features/jobs/jobForm'
import type { Job } from '../src/domain/entities'

const OWNER = 'owner-a'
const ID = '00000000-0000-4000-8000-000000000801'

const draft = {
  clientId: 'client-a',
  title: 'Panel upgrade',
  tradeType: 'Electrical' as const,
  status: 'Scheduled' as const,
  address: '10 Main St',
  description: 'Replace the service panel',
  laborHoursThousandths: 2500,
  laborRateCents: 12_500,
  notes: '',
}

it('builds owner-scoped create and update mutations with durable optimistic payloads', () => {
  const created = buildJobMutation({
    draft, entityId: ID, mutationId: '00000000-0000-4000-8000-000000000802',
    now: '2026-08-06T10:00:00.000Z', ownerId: OWNER,
  })
  expect(created).toMatchObject({ entity: 'job', entityId: ID, kind: 'create', baseVersion: null })
  expect(created.payload).toMatchObject({ ownerId: OWNER, title: draft.title, syncState: 'pending' })

  const current = created.payload as Job
  const updated = buildJobMutation({
    current, draft: { ...draft, status: 'In Progress' }, entityId: ID,
    mutationId: '00000000-0000-4000-8000-000000000803',
    now: '2026-08-06T11:00:00.000Z', ownerId: OWNER,
  })
  expect(updated).toMatchObject({ kind: 'update', baseVersion: 1 })
  expect(updated.payload).toMatchObject({ status: 'In Progress', createdAt: current.createdAt })
})

it('enforces exact job text, money, and thousandths bounds', () => {
  expect(() => JobDraftSchema.parse({ ...draft, title: '🛠'.repeat(201) })).toThrow()
  expect(() => JobDraftSchema.parse({ ...draft, laborHoursThousandths: 10_001 })).toThrow()
  expect(() => JobDraftSchema.parse({ ...draft, laborRateCents: 100_000_001 })).toThrow()
  expect(JobDraftSchema.parse({ ...draft, title: '🛠'.repeat(200) }).title).toHaveLength(400)
})

it('filters jobs with literal Unicode search and status without evaluating regex', () => {
  const rows = [
    buildJobMutation({ draft, entityId: ID, mutationId: '00000000-0000-4000-8000-000000000804', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER }).payload as Job,
    buildJobMutation({ draft: { ...draft, title: 'Café [rough-in]', status: 'Paid' }, entityId: 'job-b', mutationId: '00000000-0000-4000-8000-000000000805', now: '2026-08-06T10:00:00.000Z', ownerId: OWNER }).payload as Job,
  ]
  expect(filterJobs(rows, '[rough', 'All').map((job) => job.id)).toEqual(['job-b'])
  expect(filterJobs(rows, 'CAFE\u0301', 'Paid').map((job) => job.id)).toEqual(['job-b'])
})
