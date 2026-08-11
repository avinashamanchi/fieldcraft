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

const invoiceMutation = (): MutationEnvelope => ({
  id: MUTATION_ID,
  ownerId: OWNER,
  entity: 'invoice',
  entityId: 'invoice-1',
  kind: 'update',
  baseVersion: 2,
  payload: (bundleMutation().payload as { invoice: unknown }).invoice,
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
  payment_terms: 'Due on receipt', status: 'Draft', version: 6,
  created_at: '2026-08-03T10:00:00.000Z', updated_at: '2026-08-03T10:00:06.000Z',
  clients: { name: 'Cloud name' },
  jobs: { title: 'Cloud job', trade_type: 'Plumbing' },
  ...overrides,
})

const rawEstimate = (overrides: Record<string, unknown> = {}) => ({
  id: 'estimate-1', user_id: OWNER, client_id: 'client-1', number: 'EST-1',
  revision: 1, status: 'Converted', title: 'Cloud estimate', scope: 'Cloud scope',
  line_items: [{ description: 'Cloud labor', type: 'labor', quantity: 1000, unitPriceCents: 200 }],
  subtotal_cents: 200, tax_basis_points: 0, tax_cents: 0, total_cents: 200,
  expires_at: '2026-09-03T10:00:00.000Z', issued_at: '2026-08-03T10:00:00.000Z',
  accepted_at: '2026-08-03T10:01:00.000Z', acceptance_recorded_by: OWNER,
  converted_job_id: 'job-1', issued_snapshot: { totalCents: 200 },
  version: 4, created_at: '2026-08-03T10:00:00.000Z',
  updated_at: '2026-08-03T10:00:04.000Z',
  ...overrides,
})

const conflictPosition = (payload: Record<string, unknown> | null, changeSeq: number) => ({
  updated_at: String(payload?.updated_at ?? '2026-08-03T10:00:10.000Z'),
  change_seq: changeSeq,
  change_id: payload === null ? 0 : changeSeq,
  source: payload === null ? 'sync_snapshot' : 'sync_changes',
})

const bundleConflictPositions = (cloud: {
  client: Record<string, unknown> | null
  job: Record<string, unknown> | null
  invoice: Record<string, unknown> | null
}) => ({
  client: conflictPosition(cloud.client, 91),
  job: conflictPosition(cloud.job, 92),
  invoice: conflictPosition(cloud.invoice, 93),
})

it('pulls one owner-filtered global change feed page with a committed owner sequence cursor', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [
        {
          change_seq: 41,
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
          change_seq: 42,
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
      cursor: { updated_at: '2026-08-03T10:00:04.000Z', change_seq: 42, change_id: 42 },
      has_more: true,
    },
  }]
  const gateway = createSupabaseGateway(client)

  const result = await gateway.pullSince(
    OWNER,
    JSON.stringify({ updatedAt: '2026-08-03T10:00:04.000Z', changeSeq: 40, changeId: 40 }),
    new AbortController().signal,
  )

  expect(client.calls).toEqual([{
    name: 'pull_sync_changes',
    parameters: {
      p_cursor_change_seq: 40,
      p_limit: 200,
    },
  }])
  expect(result.rows.map((row) => ({ entityId: row.entityId, changeSeq: row.changeSeq }))).toEqual([
    { entityId: 'client-a', changeSeq: 41 },
    { entityId: 'client-b', changeSeq: 42 },
  ])
  expect(result).toMatchObject({ hasMore: true })
  expect(JSON.parse(result.cursor)).toEqual({
    updatedAt: '2026-08-03T10:00:04.000Z',
    changeSeq: 42,
    changeId: 42,
  })
})

it.each([
  '2026-02-30T10:00:00.000Z',
  '2026-08-03T24:00:00.000Z',
  '2026-08-03T10:00:00.1234567Z',
  '2026-08-03T10:00:00.000',
])('rejects non-PostgreSQL-canonical pull timestamp %s', async (updatedAt) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [{
        change_seq: 1,
        change_id: 1,
        owner_id: OWNER,
        entity: 'client',
        entity_id: 'client-1',
        version: 4,
        updated_at: updatedAt,
        deleted: false,
        payload: rawClient({ updated_at: updatedAt }),
      }],
      cursor: { updated_at: updatedAt, change_seq: 1, change_id: 1 },
      has_more: false,
    },
  }]

  await expect(createSupabaseGateway(client).pullSince(
    OWNER,
    null,
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it.each([
  {
    label: 'a first-page prefix gap',
    previous: null,
    sequences: [2],
    cursor: { updated_at: '2026-08-03T10:00:02.000Z', change_seq: 2, change_id: 2 },
  },
  {
    label: 'a resumed-page prefix gap',
    previous: { updatedAt: '2026-08-03T10:00:40.000Z', changeSeq: 40, changeId: 40 },
    sequences: [42],
    cursor: { updated_at: '2026-08-03T10:00:42.000Z', change_seq: 42, change_id: 42 },
  },
  {
    label: 'an internal sequence gap',
    previous: { updatedAt: '2026-08-03T10:00:40.000Z', changeSeq: 40, changeId: 40 },
    sequences: [41, 43],
    cursor: { updated_at: '2026-08-03T10:00:43.000Z', change_seq: 43, change_id: 43 },
  },
  {
    label: 'a cursor that does not identify the last event',
    previous: { updatedAt: '2026-08-03T10:00:40.000Z', changeSeq: 40, changeId: 40 },
    sequences: [41],
    cursor: { updated_at: '2026-08-03T10:00:41.000Z', change_seq: 41, change_id: 999 },
  },
] as const)('rejects a pull page with $label', async ({ previous, sequences, cursor }) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: sequences.map((sequence) => ({
        change_seq: sequence,
        change_id: sequence,
        owner_id: OWNER,
        entity: 'client',
        entity_id: `client-${sequence}`,
        version: 4,
        updated_at: `2026-08-03T10:00:${String(sequence).padStart(2, '0')}.000Z`,
        deleted: false,
        payload: rawClient({
          id: `client-${sequence}`,
          updated_at: `2026-08-03T10:00:${String(sequence).padStart(2, '0')}.000Z`,
        }),
      })),
      cursor,
      has_more: false,
    },
  }]

  await expect(createSupabaseGateway(client).pullSince(
    OWNER,
    previous === null ? null : JSON.stringify(previous),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('rejects an empty pull page whose cursor mutates the prior tuple', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [],
      cursor: {
        updated_at: '2026-08-03T10:00:40.000Z',
        change_seq: 40,
        change_id: 999,
      },
      has_more: false,
    },
  }]

  await expect(createSupabaseGateway(client).pullSince(
    OWNER,
    JSON.stringify({
      updatedAt: '2026-08-03T10:00:40.000Z', changeSeq: 40, changeId: 40,
    }),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('accepts a null tombstone from the change feed without borrowing local payload fields', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [{
        change_seq: 9,
        change_id: 9,
        owner_id: OWNER,
        entity: 'client',
        entity_id: 'client-1',
        version: 4,
        updated_at: '2026-08-03T10:00:04.000Z',
        deleted: true,
        payload: null,
      }],
      cursor: { updated_at: '2026-08-03T10:00:04.000Z', change_seq: 9, change_id: 9 },
      has_more: false,
    },
  }]

  await expect(
    createSupabaseGateway(client).pullSince(
      OWNER,
      JSON.stringify({ updatedAt: '2026-08-03T10:00:08.000Z', changeSeq: 8, changeId: 8 }),
      new AbortController().signal,
    ),
  ).resolves.toMatchObject({
    rows: [{ entityId: 'client-1', payload: null, deleted: true, version: 4, changeSeq: 9, changeId: 9 }],
    hasMore: false,
  })
})

it('normalizes historical invoices identically across relation-event page boundaries', async () => {
  const invoiceChange = {
    change_seq: 31,
    change_id: 31,
    owner_id: OWNER,
    entity: 'invoice',
    entity_id: 'invoice-1',
    version: 6,
    updated_at: '2026-08-03T10:00:06.000Z',
    deleted: false,
    payload: rawInvoice({
      clients: { name: 'Historical client' },
      jobs: { title: 'Historical job', trade_type: 'Electrical' },
    }),
  }
  const samePageClient = new Client()
  samePageClient.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [
        invoiceChange,
        {
          change_seq: 32,
          change_id: 32,
          owner_id: OWNER,
          entity: 'client',
          entity_id: 'client-1',
          version: 5,
          updated_at: '2026-08-03T10:00:07.000Z',
          deleted: false,
          payload: rawClient({
            name: 'Later client on same page',
            version: 5,
            updated_at: '2026-08-03T10:00:07.000Z',
          }),
        },
        {
          change_seq: 33,
          change_id: 33,
          owner_id: OWNER,
          entity: 'job',
          entity_id: 'job-1',
          version: 6,
          updated_at: '2026-08-03T10:00:08.000Z',
          deleted: false,
          payload: rawJob({
            title: 'Later job on same page',
            trade_type: 'Plumbing',
            version: 6,
            updated_at: '2026-08-03T10:00:08.000Z',
          }),
        },
      ],
      cursor: { updated_at: '2026-08-03T10:00:08.000Z', change_seq: 33, change_id: 33 },
      has_more: false,
    },
  }]
  const splitPageClient = new Client()
  splitPageClient.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'ok',
      changes: [invoiceChange],
      cursor: { updated_at: '2026-08-03T10:00:06.000Z', change_seq: 31, change_id: 31 },
      has_more: true,
    },
  }]

  const samePage = await createSupabaseGateway(samePageClient).pullSince(
    OWNER,
    JSON.stringify({ updatedAt: '2026-08-03T10:00:05.000Z', changeSeq: 30, changeId: 30 }),
    new AbortController().signal,
  )
  const splitPage = await createSupabaseGateway(splitPageClient).pullSince(
    OWNER,
    JSON.stringify({ updatedAt: '2026-08-03T10:00:05.000Z', changeSeq: 30, changeId: 30 }),
    new AbortController().signal,
  )
  const samePageInvoice = samePage.rows.find((row) => row.entity === 'invoice')
  const splitPageInvoice = splitPage.rows.find((row) => row.entity === 'invoice')

  expect((samePageInvoice?.payload as { draft: unknown }).draft).toEqual(
    (splitPageInvoice?.payload as { draft: unknown }).draft,
  )
  expect(samePageInvoice).toMatchObject({
    payload: {
      draft: {
        clientName: 'Historical client',
        jobTitle: 'Historical job',
        tradeType: 'Electrical',
      },
    },
  })
})

it.each(['clients', 'jobs'] as const)(
  'rejects a pull invoice missing its immutable embedded %s snapshot instead of borrowing a later row',
  async (missingRelationship) => {
    const invoice = rawInvoice()
    delete invoice[missingRelationship]
    const laterEntity = missingRelationship === 'clients' ? 'client' : 'job'
    const laterPayload = laterEntity === 'client'
      ? rawClient({
          name: 'Later client must not rewrite the invoice',
          version: 7,
          updated_at: '2026-08-03T10:00:07.000Z',
        })
      : rawJob({
          title: 'Later job must not rewrite the invoice',
          version: 7,
          updated_at: '2026-08-03T10:00:07.000Z',
        })
    const client = new Client()
    client.replies = [{
      status: 200,
      error: null,
      data: {
        status: 'ok',
        changes: [
          {
            change_seq: 31,
            change_id: 31,
            owner_id: OWNER,
            entity: 'invoice',
            entity_id: 'invoice-1',
            version: 6,
            updated_at: '2026-08-03T10:00:06.000Z',
            deleted: false,
            payload: invoice,
          },
          {
            change_seq: 32,
            change_id: 32,
            owner_id: OWNER,
            entity: laterEntity,
            entity_id: `${laterEntity}-1`,
            version: 7,
            updated_at: '2026-08-03T10:00:07.000Z',
            deleted: false,
            payload: laterPayload,
          },
        ],
        cursor: {
          updated_at: '2026-08-03T10:00:07.000Z',
          change_seq: 32,
          change_id: 32,
        },
        has_more: false,
      },
    }]

    await expect(createSupabaseGateway(client).pullSince(
      OWNER,
      JSON.stringify({ updatedAt: '2026-08-03T10:00:05.000Z', changeSeq: 30, changeId: 30 }),
      new AbortController().signal,
    )).rejects.toMatchObject({ reason: 'invalid-response' })
  },
)

it('carries the immutable generic receipt position into the acknowledged cloud row', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'client',
      kind: 'update',
      entity_id: 'client-1',
      cloud: rawClient(),
      sync_position: {
        updated_at: '2026-08-03T10:00:04.000Z', change_seq: 77, change_id: 77, source: 'sync_changes',
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'applied',
    rows: [{ entityId: 'client-1', updatedAt: '2026-08-03T10:00:04.000Z', changeSeq: 77, changeId: 77 }],
  })
})

it('rejects snapshot authority on a present applied receipt', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'client',
      kind: 'update',
      entity_id: 'client-1',
      cloud: rawClient(),
      sync_position: {
        updated_at: '2026-08-03T10:00:04.000Z',
        change_seq: 1_000_000,
        change_id: 0,
        source: 'sync_snapshot',
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it.each([
  ['legacy receipt with a positive change ID', 'legacy_receipt', 77],
  ['sync change with the reserved zero change ID', 'sync_changes', 0],
] as const)('rejects a generic receipt position with %s', async (
  _label,
  source,
  changeId,
) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'client',
      kind: 'update',
      entity_id: 'client-1',
      cloud: rawClient(),
      sync_position: {
        updated_at: '2026-08-03T10:00:04.000Z',
        change_seq: source === 'legacy_receipt' ? 0 : 1,
        change_id: changeId,
        source,
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('rejects an otherwise valid applied receipt without comparable immutable position metadata', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'client',
      kind: 'update',
      entity_id: 'client-1',
      cloud: rawClient(),
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('accepts an identity-bound legacy invoice repair only with an immutable feed position', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'invoice',
      kind: 'update',
      entity_id: 'invoice-1',
      cloud: null,
      repair_from_feed: true,
      sync_position: {
        updated_at: '2026-08-03T10:00:06.000Z',
        change_seq: 0,
        change_id: 0,
        source: 'legacy_receipt',
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    invoiceMutation(),
    new AbortController().signal,
  )).resolves.toEqual({
    type: 'applied',
    rows: [],
    requiresBootstrapRepair: true,
  })
})

it.each([
  {
    label: 'another entity',
    mutation: clientMutation(),
    position: { updated_at: '2026-08-03T10:00:04.000Z', change_seq: 0, change_id: 0 },
  },
  {
    label: 'no immutable position',
    mutation: invoiceMutation(),
    position: undefined,
  },
])('rejects a legacy repair marker with $label', async ({ mutation, position }) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: mutation.entity,
      kind: mutation.kind,
      entity_id: mutation.entityId,
      cloud: null,
      repair_from_feed: true,
      ...(position ? { sync_position: position } : {}),
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    mutation,
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
})

it('binds each applied bundle member to its own immutable receipt position', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      client: rawClient(),
      job: rawJob(),
      invoice: rawInvoice(),
      sync_positions: {
        client: {
          updated_at: '2026-08-03T10:00:04.000Z', change_seq: 81, change_id: 81, source: 'sync_changes',
        },
        job: {
          updated_at: '2026-08-03T10:00:05.000Z', change_seq: 82, change_id: 82, source: 'sync_changes',
        },
        invoice: {
          updated_at: '2026-08-03T10:00:06.000Z', change_seq: 83, change_id: 83, source: 'sync_changes',
        },
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'applied',
    rows: [
      { entity: 'client', changeSeq: 81, changeId: 81 },
      { entity: 'job', changeSeq: 82, changeId: 82 },
      { entity: 'invoice', changeSeq: 83, changeId: 83 },
    ],
  })
})

it.each([
  ['legacy receipt with a positive change ID', 'legacy_receipt', 81],
  ['sync change with the reserved zero change ID', 'sync_changes', 0],
] as const)('rejects a bundle member position with %s', async (
  _label,
  source,
  changeId,
) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      client: rawClient(),
      job: rawJob(),
      invoice: rawInvoice(),
      sync_positions: {
        client: {
          updated_at: '2026-08-03T10:00:04.000Z',
          change_seq: source === 'legacy_receipt' ? 0 : 1,
          change_id: changeId, source,
        },
        job: {
          updated_at: '2026-08-03T10:00:05.000Z', change_seq: 82, change_id: 82, source: 'sync_changes',
        },
        invoice: {
          updated_at: '2026-08-03T10:00:06.000Z', change_seq: 83, change_id: 83, source: 'sync_changes',
        },
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
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
      sync_position: conflictPosition(rawClient(), 91),
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

it('rejects snapshot authority on a present conflict row', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID,
      entity: 'client', entity_id: 'client-1', cloud_version: 4,
      cloud_payload: rawClient(),
      sync_position: {
        updated_at: '2026-08-03T10:00:04.000Z',
        change_seq: 1_000_000,
        change_id: 0,
        source: 'sync_snapshot',
      },
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    clientMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
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
      sync_position: conflictPosition(null, 91),
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

it('sends an explicit recreation and preserves a concurrent remote recreation as a new conflict', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID,
      entity: 'client', entity_id: 'client-1', cloud_version: 1,
      cloud_payload: rawClient({ version: 1 }),
      sync_position: conflictPosition(rawClient({ version: 1 }), 91),
    },
  }]
  const recreation = clientMutation({
    kind: 'create',
    baseVersion: null,
    payload: localClient({ version: 0 }),
  })

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    recreation,
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'conflict',
    conflict: { mutationKind: 'create', cloudVersion: 1 },
  })
  expect(client.calls[0]).toMatchObject({
    name: 'apply_entity_mutation',
    parameters: { p_kind: 'create', p_base_version: null },
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
      sync_positions: bundleConflictPositions({
        client: rawClient(), job: rawJob(), invoice: rawInvoice(),
      }),
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

it.each([
  {
    label: 'invoice',
    cloudPayload: { client: rawClient(), job: rawJob(), invoice: null },
    cloudVersions: { client: 4, job: 5, invoice: 0 },
    expected: { client: { version: 4 }, job: { version: 5 }, invoice: null },
  },
  {
    label: 'job and invoice',
    cloudPayload: { client: rawClient(), job: null, invoice: null },
    cloudVersions: { client: 4, job: 0, invoice: 0 },
    expected: { client: { version: 4 }, job: null, invoice: null },
  },
  {
    label: 'client, job, and invoice',
    cloudPayload: { client: null, job: null, invoice: null },
    cloudVersions: { client: 0, job: 0, invoice: 0 },
    expected: { client: null, job: null, invoice: null },
  },
])('preserves a compound conflict when the remote $label member is deleted', async ({
  cloudPayload,
  cloudVersions,
  expected,
}) => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      cloud_versions: cloudVersions,
      local_payload: bundleMutation().payload,
      cloud_payload: cloudPayload,
      sync_positions: bundleConflictPositions(cloudPayload),
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'conflict',
    conflict: { cloudPayload: expected, cloudVersion: cloudVersions.invoice },
  })
})

it('rejects a compound conflict whose remaining rows violate deletion relationships', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'conflict', mutation_id: MUTATION_ID, entity: 'invoice_bundle',
      entity_ids: { client: 'client-1', job: 'job-1', invoice: 'invoice-1' },
      cloud_versions: { client: 4, job: 0, invoice: 6 },
      local_payload: bundleMutation().payload,
      cloud_payload: { client: rawClient(), job: null, invoice: rawInvoice() },
      sync_positions: bundleConflictPositions({ client: rawClient(), job: null, invoice: rawInvoice() }),
    },
  }]

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    bundleMutation(),
    new AbortController().signal,
  )).rejects.toMatchObject({ reason: 'invalid-response' })
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

it('routes conversion through its dedicated RPC and validates every returned canonical row', async () => {
  const client = new Client()
  client.replies = [{
    status: 200,
    error: null,
    data: {
      status: 'applied',
      mutation_id: MUTATION_ID,
      entity: 'estimate',
      kind: 'convert_estimate',
      entity_id: 'estimate-1',
      cloud: rawEstimate(),
      sync_position: {
        updated_at: '2026-08-03T10:00:04.000Z', change_seq: 80, change_id: 80, source: 'sync_changes',
      },
      cloud_rows: [{
        entity: 'job',
        cloud: rawJob({ updated_at: '2026-08-03T10:00:03.000Z', version: 3 }),
        sync_position: {
          updated_at: '2026-08-03T10:00:03.000Z', change_seq: 79, change_id: 79, source: 'sync_changes',
        },
      }],
    },
  }]
  const mutation: MutationEnvelope = {
    id: MUTATION_ID,
    ownerId: OWNER,
    entity: 'estimate',
    entityId: 'estimate-1',
    kind: 'convert_estimate',
    baseVersion: 3,
    payload: {
      estimateId: 'estimate-1', jobId: 'job-1', baseVersion: 3,
      now: '2026-08-03T10:00:03.000Z',
    },
    createdAt: '2026-08-03T10:00:03.000Z',
    attempts: 0,
  }

  await expect(createSupabaseGateway(client).pushMutation(
    OWNER,
    mutation,
    new AbortController().signal,
  )).resolves.toMatchObject({
    type: 'applied',
    rows: [
      { entity: 'estimate', entityId: 'estimate-1', changeSeq: 80 },
      { entity: 'job', entityId: 'job-1', changeSeq: 79 },
    ],
  })
  expect(client.calls).toEqual([{
    name: 'convert_estimate',
    parameters: { p_mutation_id: MUTATION_ID, p_payload: mutation.payload },
  }])
})
