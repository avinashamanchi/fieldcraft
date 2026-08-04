import type { MutationEnvelope } from '../src/domain/sync'
import { createSupabaseGateway } from '../src/data/supabaseGateway'

const OWNER = 'owner-a'
const MUTATION_ID = '00000000-0000-4000-8000-000000000091'

type Reply = { data: unknown; error: unknown | null; status: number }

class Client {
  readonly calls: { name: string; parameters: Record<string, unknown> }[] = []
  replies: (Reply | Promise<Reply>)[] = []

  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<Reply> {
    this.calls.push({ name, parameters })
    return Promise.resolve(this.replies.shift() ?? { data: null, error: null, status: 200 })
  }
  from(): never { throw new Error('The sync feed must not scan base tables') }
  channel() {
    return { on() { return this }, subscribe() { return this }, unsubscribe() {} }
  }
}

const rawClient = (overrides: Record<string, unknown> = {}) => ({
  id: 'client-1',
  user_id: OWNER,
  name: 'Cloud name',
  version: 4,
  created_at: '2026-08-03T10:00:00.000Z',
  updated_at: '2026-08-03T10:00:04.000Z',
  ...overrides,
})

const localClient = (overrides: Record<string, unknown> = {}) => ({
  id: 'client-1',
  ownerId: OWNER,
  name: 'My edit',
  notes: 'local-only value',
  version: 2,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:02.000Z',
  syncState: 'pending',
  ...overrides,
})

const clientMutation = (overrides: Partial<MutationEnvelope> = {}): MutationEnvelope => ({
  id: MUTATION_ID,
  ownerId: OWNER,
  entity: 'client',
  entityId: 'client-1',
  kind: 'update',
  baseVersion: 2,
  payload: localClient(),
  createdAt: '2026-08-03T10:00:02.000Z',
  attempts: 0,
  ...overrides,
})

const bundleMutation = (): MutationEnvelope => ({
  id: MUTATION_ID,
  ownerId: OWNER,
  entity: 'invoice',
  entityId: 'invoice-1',
  kind: 'save_invoice_bundle',
  baseVersion: 2,
  payload: {
    client: localClient(),
    job: {
      id: 'job-1', ownerId: OWNER, clientId: 'client-1', title: 'My job', status: 'Invoiced',
      version: 2, createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'pending',
    },
    invoice: {
      id: 'invoice-1', ownerId: OWNER, clientId: 'client-1', jobId: 'job-1',
      version: 2, createdAt: '2026-08-03T10:00:00.000Z',
      updatedAt: '2026-08-03T10:00:02.000Z', syncState: 'pending',
      draft: {
        clientName: 'My edit', jobTitle: 'My job', tradeType: 'Plumbing',
        taxBasisPoints: 0, paymentTerms: 'Due on receipt',
        lineItems: [{ description: 'Local labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
      },
      subtotalCents: 100, taxCents: 0, totalCents: 100,
    },
  },
  createdAt: '2026-08-03T10:00:02.000Z',
  attempts: 0,
})

const rawJob = (overrides: Record<string, unknown> = {}) => ({
  id: 'job-1', user_id: OWNER, client_id: 'client-1', title: 'Cloud job',
  trade_type: 'Plumbing', status: 'Invoiced', version: 5,
  created_at: '2026-08-03T10:00:00.000Z', updated_at: '2026-08-03T10:00:05.000Z',
  ...overrides,
})

const rawInvoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'invoice-1', user_id: OWNER, client_id: 'client-1', job_id: 'job-1', number: 'INV-1',
  line_items: [{ description: 'Cloud labor', type: 'labor', quantity: 1000, unitPriceCents: 200 }],
  subtotal_cents: 200, tax_basis_points: 0, tax_cents: 0, total_cents: 200,
  payment_terms: 'Due on receipt', version: 6,
  created_at: '2026-08-03T10:00:00.000Z', updated_at: '2026-08-03T10:00:06.000Z',
  clients: { name: 'Cloud name' },
  jobs: { title: 'Cloud job', trade_type: 'Plumbing' },
  ...overrides,
})

it('pulls one owner-filtered global change feed page with an updated_at/change_id cursor', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [
        {
          change_id: 41,
          owner_id: OWNER,
          entity: 'client',
          entity_id: 'client-a',
          version: 1,
          updated_at: '2026-08-03T10:00:04.000Z',
          deleted: false,
          payload: rawClient({ id: 'client-a', version: 1 }),
        },
        {
          change_id: 42,
          owner_id: OWNER,
          entity: 'client',
          entity_id: 'client-b',
          version: 1,
          updated_at: '2026-08-03T10:00:04.000Z',
          deleted: false,
          payload: rawClient({ id: 'client-b', version: 1 }),
        },
      ],
      cursor: { updated_at: '2026-08-03T10:00:04.000Z', change_id: 42 },
      has_more: true,
    },
  }]
  const gateway = createSupabaseGateway(client)

  const result = await gateway.pullSince(
    OWNER,
    JSON.stringify({ updatedAt: '2026-08-03T10:00:04.000Z', changeId: 40 }),
    new AbortController().signal,
  )

  expect(client.calls).toEqual([{
    name: 'pull_sync_changes',
    parameters: {
      p_cursor_updated_at: '2026-08-03T10:00:04.000Z',
      p_cursor_change_id: 40,
      p_limit: 500,
    },
  }])
  expect(result.rows.map((row) => row.entityId)).toEqual(['client-a', 'client-b'])
  expect(result).toMatchObject({ hasMore: true })
  expect(JSON.parse(result.cursor)).toEqual({
    updatedAt: '2026-08-03T10:00:04.000Z',
    changeId: 42,
  })
})

it('accepts a null tombstone from the change feed without borrowing local payload fields', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [{
        change_id: 9,
        owner_id: OWNER,
        entity: 'client',
        entity_id: 'client-1',
        version: 4,
        updated_at: '2026-08-03T10:00:04.000Z',
        deleted: true,
        payload: null,
      }],
      cursor: { updated_at: '2026-08-03T10:00:04.000Z', change_id: 9 },
      has_more: false,
    },
  }]

  await expect(
    createSupabaseGateway(client).pullSince(OWNER, null, new AbortController().signal),
  ).resolves.toMatchObject({
    rows: [{ entityId: 'client-1', payload: null, deleted: true, version: 4 }],
    hasMore: false,
  })
})

it('rejects applied replies that are not bound to the exact mutation and entity identity', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: '00000000-0000-4000-8000-000000000099',
      entity: 'client', kind: 'update', entity_id: 'client-1', cloud: rawClient(),
    },
  }]

  await expect(
    createSupabaseGateway(client).pushMutation(OWNER, clientMutation(), new AbortController().signal),
  ).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('normalizes conflict cloud state independently instead of merging omitted local fields', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID,
      entity: 'client', entity_id: 'client-1', cloud_version: 4,
      cloud_payload: rawClient(),
    },
  }]

  const result = await createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )

  expect(result).toMatchObject({
    type: 'conflict',
    conflict: { cloudPayload: { name: 'Cloud name', version: 4 } },
  })
  expect((result as { conflict: { cloudPayload: Record<string, unknown> } }).conflict.cloudPayload)
    .not.toHaveProperty('notes')
})

it('preserves a null cloud tombstone in a conflict instead of fabricating local state', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID,
      entity: 'client', entity_id: 'client-1', cloud_version: 0,
      cloud_payload: null,
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'conflict',
    conflict: { ownerId: OWNER, cloudPayload: null, cloudVersion: 0 },
  })
})

it('validates and preserves a structured stale invoice bundle with all cloud versions', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      cloud_versions: { client: 4, job: 5, invoice: 6 },
      local_payload: bundleMutation().payload,
      cloud_payload: {
        client: rawClient(),
        job: rawJob(),
        invoice: rawInvoice(),
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'conflict',
    conflict: {
      mutationKind: 'save_invoice_bundle',
      entity: 'invoice',
      entityId: 'invoice-1',
      cloudVersion: 6,
      cloudPayload: {
        client: { version: 4, name: 'Cloud name' },
        job: { version: 5, clientId: 'client-1' },
        invoice: { version: 6, clientId: 'client-1', jobId: 'job-1' },
      },
    },
  })
})

it('rejects bundle rows whose canonical IDs do not match the bound entity IDs', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      client: rawClient({ id: 'different-client' }),
      job: rawJob({ client_id: 'different-client' }),
      invoice: rawInvoice({ client_id: 'different-client' }),
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('bounds a hung RPC with a gateway deadline even when the provider ignores abort', async () => {
  jest.useFakeTimers()
  try {
    const client = new Client()
    client.replies = [new Promise<Reply>(() => {})]
    const request = createSupabaseGateway(client, { deadlineMs: 1_000 }).pushMutation(
      OWNER,
      clientMutation(),
      new AbortController().signal,
    )
    const rejection = expect(request).rejects.toMatchObject({ reason: 'transient' })
    await jest.advanceTimersByTimeAsync(1_000)
    await rejection
  } finally {
    jest.useRealTimers()
  }
})
