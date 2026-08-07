import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { PGlite } from '@electric-sql/pglite'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const readMigration = (name) =>
  readFile(`${projectRoot}/supabase/migrations/${name}`, 'utf8')

const ownerId = '70000000-0000-0000-0000-000000000071'
const clientId = '71000000-0000-0000-0000-000000000071'
const jobId = '72000000-0000-0000-0000-000000000071'
const invoiceId = '73000000-0000-0000-0000-000000000071'
const legacyMutationId = '74000000-0000-0000-0000-000000000071'
const legacyConflictMutationId = '74000000-0000-0000-0000-000000000072'
const unboundLegacyConflictMutationId = '74000000-0000-0000-0000-000000000079'
const truncatedConflictMutationId = '74000000-0000-0000-0000-000000000077'
const mismatchedConflictMutationId = '74000000-0000-0000-0000-000000000078'
const nullNumberMutationId = '74000000-0000-0000-0000-000000000074'
const nullPaymentTermsMutationId = '74000000-0000-0000-0000-000000000075'
const missingStatusMutationId = '74000000-0000-0000-0000-000000000076'
const invoiceMutationId = '75000000-0000-0000-0000-000000000073'
const createdInvoiceId = '73000000-0000-0000-0000-000000000073'
const createMutationId = '75000000-0000-0000-0000-000000000071'
const deleteMutationId = '75000000-0000-0000-0000-000000000072'
const createdClientId = '76000000-0000-0000-0000-000000000071'
const directClientId = '76000000-0000-0000-0000-000000000072'
const rewrittenClientId = '76000000-0000-0000-0000-000000000073'
const sentinelMutationId = '77000000-0000-0000-0000-000000000071'
const conflictMutationId = '77000000-0000-0000-0000-000000000072'
const absentConflictMutationId = '77000000-0000-0000-0000-000000000073'
const bundleMutationId = '78000000-0000-0000-0000-000000000071'
const bundleConflictMutationId = '78000000-0000-0000-0000-000000000072'
const bundleClientId = '79000000-0000-0000-0000-000000000071'
const bundleJobId = '79000000-0000-0000-0000-000000000072'
const bundleInvoiceId = '79000000-0000-0000-0000-000000000073'
const secondOwnerId = '70000000-0000-0000-0000-000000000072'
const roleOnboardingMutationId = '7a000000-0000-4000-8000-000000000072'

const db = new PGlite()
const failures = []
let checks = 0

const verify = async (label, operation) => {
  checks += 1
  try {
    await operation()
    process.stdout.write(`PASS ${label}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${label}: ${message}`)
    process.stdout.write(`FAIL ${label}: ${message}\n`)
  }
}

const expectSqlState = async (operation, expectedCode) => {
  try {
    await operation()
  } catch (error) {
    if (error && typeof error === 'object' && error.code === expectedCode) return
    throw error
  }
  throw new Error(`expected SQLSTATE ${expectedCode}`)
}

const withRole = async (role, operation) => {
  await db.exec(`set role ${role}`)
  try {
    return await operation()
  } finally {
    await db.exec('reset role')
  }
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role public_client;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb
    language sql stable
    as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
  `)

  await db.exec(await readMigration('202608030001_fieldcraft_core.sql'))
  await db.exec(await readMigration('202608030002_fieldcraft_functions.sql'))

  // This fixture deliberately creates an invoice before more than one feed page
  // of newer rows and before its current relationship snapshots. Migration 003
  // must make the invoice row self-contained rather than relying on page order.
  await db.exec(`
    insert into auth.users (id, email)
    values
      ('${ownerId}', 'migration-order@example.test'),
      ('${secondOwnerId}', 'second-owner@example.test');

    insert into public.profiles (id, display_name, business_name)
    values ('${secondOwnerId}', 'Second Owner', 'Separate Business');

    insert into public.clients (
      id, user_id, name, version, created_at, updated_at
    ) values (
      '${clientId}', '${ownerId}', 'Current client snapshot', 4,
      '2026-08-03T09:00:00Z', '2026-08-03T10:05:00Z'
    );

    insert into public.jobs (
      id, user_id, client_id, title, trade_type, status, version,
      created_at, updated_at
    ) values (
      '${jobId}', '${ownerId}', '${clientId}',
      'Current job snapshot', 'General', 'Invoiced', 3,
      '2026-08-03T09:00:00Z', '2026-08-03T10:05:00Z'
    );

    insert into public.invoices (
      id, user_id, client_id, job_id, number, line_items,
      subtotal_cents, tax_basis_points, tax_cents, total_cents,
      payment_terms, status, version, created_at, updated_at
    ) values (
      '${invoiceId}', '${ownerId}', '${clientId}', '${jobId}',
      'PRE-003-071',
      '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}]',
      100, 0, 0, 100, 'Due on receipt', 'Draft', 2,
      '2026-08-03T09:00:00Z', '2026-08-03T10:00:00Z'
    );

    insert into public.services (
      id, user_id, name, version, created_at, updated_at
    )
    select gen_random_uuid(),
           '${ownerId}',
           'Later page filler ' || generated,
           1,
           '2026-08-03T09:00:00Z',
           '2026-08-03T10:01:00Z'::timestamptz
             + generated * interval '1 microsecond'
    from generate_series(1, 501) as generated;

    insert into public.mutation_receipts (
      user_id, mutation_id, response, created_at, updated_at
    )
    select
      '${ownerId}',
      '${legacyMutationId}',
      jsonb_build_object(
        'status', 'applied',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', to_jsonb(invoice)
      ),
      '2026-08-03T10:00:01Z',
      '2026-08-03T10:00:01Z'
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (user_id, mutation_id, response)
    select
      '${ownerId}',
      '${unboundLegacyConflictMutationId}',
      jsonb_build_object(
        'status', 'conflict',
        'mutation_id', '${unboundLegacyConflictMutationId}',
        'entity', 'invoice',
        'entity_id', invoice.id,
        'base_version', 1,
        'local_version', 1,
        'local_payload', '{"number":"ambiguous legacy mutation"}'::jsonb,
        'cloud_version', invoice.version,
        'cloud', to_jsonb(invoice),
        'cloud_payload', to_jsonb(invoice)
      )
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (user_id, mutation_id, response)
    values (
      '${ownerId}',
      '${truncatedConflictMutationId}',
      jsonb_build_object(
        'status', 'conflict',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', '${invoiceId}',
        'cloud', jsonb_build_object('id', '${invoiceId}', 'user_id', '${ownerId}'),
        'cloud_version', 1
      )
    );

    insert into public.mutation_receipts (user_id, mutation_id, response)
    select
      '${ownerId}',
      '${mismatchedConflictMutationId}',
      jsonb_build_object(
        'status', 'conflict',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', jsonb_set(to_jsonb(invoice), '{version}', '1'::jsonb),
        'cloud_version', 999
      )
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (
      user_id, mutation_id, response, created_at, updated_at
    )
    select
      '${ownerId}',
      '${legacyConflictMutationId}',
      jsonb_build_object(
        'status', 'conflict',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', jsonb_set(
          jsonb_set(to_jsonb(invoice), '{version}', '1'::jsonb),
          '{updated_at}',
          '"2026-08-03T09:59:00Z"'::jsonb
        ),
        'cloud_version', 1
      ),
      '2026-08-03T09:59:01Z',
      '2026-08-03T09:59:01Z'
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (user_id, mutation_id, response)
    select
      '${ownerId}',
      '${nullNumberMutationId}',
      jsonb_build_object(
        'status', 'applied',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', jsonb_set(to_jsonb(invoice), '{number}', 'null'::jsonb)
      )
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (user_id, mutation_id, response)
    select
      '${ownerId}',
      '${nullPaymentTermsMutationId}',
      jsonb_build_object(
        'status', 'applied',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', jsonb_set(to_jsonb(invoice), '{payment_terms}', 'null'::jsonb)
      )
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';

    insert into public.mutation_receipts (user_id, mutation_id, response)
    select
      '${ownerId}',
      '${missingStatusMutationId}',
      jsonb_build_object(
        'status', 'applied',
        'entity', 'invoice',
        'kind', 'update',
        'entity_id', invoice.id,
        'cloud', to_jsonb(invoice) - 'status'
      )
    from public.invoices as invoice
    where invoice.id = '${invoiceId}';
  `)

  await db.exec(await readMigration('202608030003_fieldcraft_sync_changes.sql'))
  await db.exec(await readMigration('202608060004_fieldcraft_ai_rate_limits.sql'))
  await db.exec(await readMigration('202608070001_fieldcraft_identity_security.sql'))
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${ownerId}', false)`,
  )

  await verify('AI rate limits are atomic and independently scoped', async () => {
    const userDigest = 'a'.repeat(64)
    const networkDigest = 'b'.repeat(64)
    const first = await db.query(
      'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
      [userDigest, 'invoice.parse.v1', 1],
    )
    const second = await db.query(
      'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
      [userDigest, 'invoice.parse.v1', 1],
    )
    const independent = await db.query(
      'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
      [networkDigest, 'invoice.parse.v1', 1],
    )
    if (
      first.rows[0]?.allowed !== true || second.rows[0]?.allowed !== false ||
      independent.rows[0]?.allowed !== true || Number(second.rows[0]?.retry_after_seconds) < 1
    ) {
      throw new Error(`unexpected limits: ${JSON.stringify({ first: first.rows[0], second: second.rows[0], independent: independent.rows[0] })}`)
    }
  })

  await verify('migration 003 installs an owner-committed synchronization sequence', async () => {
    const result = await db.query(`
      select counter.last_change_seq,
             count(change.change_seq)::int as event_count,
             count(distinct change.change_seq)::int as distinct_sequences
      from public.sync_owner_counters as counter
      left join public.sync_changes as change on change.user_id = counter.user_id
      where counter.user_id = $1
      group by counter.last_change_seq
    `, [ownerId])
    const row = result.rows[0]
    if (
      !row ||
      Number(row.last_change_seq) !== row.event_count ||
      row.event_count !== row.distinct_sequences
    ) {
      throw new Error(`owner sequence was ${JSON.stringify(row ?? null)}`)
    }
  })

  await verify('pull pages are capped to the stable owner head read for that response', async () => {
    const result = await db.query(`
      select pg_get_functiondef(
        'public.pull_sync_changes(bigint,integer)'::regprocedure
      ) as definition
    `)
    if (!result.rows[0]?.definition.includes('change.change_seq <= v_head_change_seq')) {
      throw new Error('pull page query is not capped to its captured owner head')
    }
  })

  await verify(
    'migration 003 emits a self-contained pre-003 invoice before later relationship rows',
    async () => {
      const result = await db.query(
        'select public.pull_sync_changes(null, 500) as response',
      )
      const response = result.rows[0].response
      const invoice = response.changes.find(
        (change) => change.entity === 'invoice' && change.entity_id === invoiceId,
      )

      if (!invoice) {
        throw new Error('invoice was not present on the first 500-row page')
      }
      if (
        response.changes.some(
          (change) =>
            (change.entity === 'client' && change.entity_id === clientId) ||
            (change.entity === 'job' && change.entity_id === jobId),
        )
      ) {
        throw new Error('relationship rows unexpectedly appeared on the invoice page')
      }
      if (invoice.payload?.clients?.name !== 'Current client snapshot') {
        throw new Error(
          `client snapshot was ${JSON.stringify(invoice.payload?.clients ?? null)}`,
        )
      }
      if (invoice.payload?.jobs?.title !== 'Current job snapshot') {
        throw new Error(
          `job snapshot was ${JSON.stringify(invoice.payload?.jobs ?? null)}`,
        )
      }
    },
  )

  await verify(
    'a new generic invoice binds its exact mutation event instead of requesting legacy repair',
    async () => {
      try {
        const result = await db.query(`
          select public.apply_entity_mutation(
            '${invoiceMutationId}',
            'invoice',
            'create',
            '${createdInvoiceId}',
            null,
            '{
              "clientId":"${clientId}",
              "jobId":"${jobId}",
              "number":"NEW-003-073",
              "lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],
              "subtotalCents":100,
              "taxBasisPoints":0,
              "taxCents":0,
              "totalCents":100,
              "paymentTerms":"Due on receipt",
              "status":"Draft"
            }'
          ) as response
        `)
        const response = result.rows[0].response
        if (
          response.status !== 'applied' ||
          response.repair_from_feed !== undefined ||
          response.cloud?.clients?.name !== 'Current client snapshot' ||
          response.cloud?.jobs?.title !== 'Current job snapshot' ||
          response.sync_position?.source !== 'sync_changes'
        ) {
          throw new Error(`new invoice response was ${JSON.stringify(response)}`)
        }
        const match = await db.query(
          `
            select count(*)::int as count
            from public.sync_changes
            where user_id = $1
              and mutation_id = $2
              and entity = 'invoice'
              and entity_id = $3
              and change_id = $4
              and updated_at = $5::timestamptz
          `,
          [
            ownerId,
            invoiceMutationId,
            createdInvoiceId,
            response.sync_position.change_id,
            response.sync_position.updated_at,
          ],
        )
        if (match.rows[0].count !== 1) {
          throw new Error('new invoice position did not identify its mutation event')
        }
      } finally {
        await db.exec(`
          begin;
          select public.fieldcraft_lock_sync_owner('${ownerId}', null);
          delete from public.invoices where id = '${createdInvoiceId}';
          commit;
        `)
      }
    },
  )

  let legacyConflictResponse
  await verify(
    'a pre-003 invoice conflict rebinds to one complete current canonical snapshot',
    async () => {
      const result = await db.query(`
        select public.apply_entity_mutation(
          '${legacyConflictMutationId}',
          'invoice',
          'update',
          '${invoiceId}',
          1,
          '{}'
        ) as response
      `)
      const response = result.rows[0].response
      legacyConflictResponse = response
      if (
        response.status !== 'conflict' ||
        Number(response.cloud_version) !== 2 ||
        response.cloud_payload?.clients?.name !== 'Current client snapshot' ||
        response.cloud_payload?.jobs?.title !== 'Current job snapshot' ||
        response.sync_position?.source !== 'sync_changes'
      ) {
        throw new Error(`legacy invoice conflict was ${JSON.stringify(response)}`)
      }
    },
  )

  for (const [label, mutationId] of [
    ['a truncated legacy invoice conflict fails closed', truncatedConflictMutationId],
    ['a legacy invoice conflict with a mismatched cloud version fails closed', mismatchedConflictMutationId],
  ]) {
    await verify(label, async () => {
      await expectSqlState(
        () => db.query(`
          select public.apply_entity_mutation(
            '${mutationId}',
            'invoice',
            'update',
            '${invoiceId}',
            1,
            '{}'
          )
        `),
        '22023',
      )
    })
  }

  // Once the authoritative feed entities are gone, migration-002 receipts do
  // not contain enough relationship history to reconstruct an invoice safely.
  await db.exec(`
    begin;
    select public.fieldcraft_lock_sync_owner('${ownerId}', null);
    delete from public.invoices where id = '${invoiceId}';
    delete from public.jobs where id = '${jobId}';
    delete from public.clients where id = '${clientId}';
    commit;
  `)

  await verify('the rebound legacy invoice conflict is byte-stable after canonical deletion', async () => {
    const result = await db.query(`
      select public.apply_entity_mutation(
        '${legacyConflictMutationId}',
        'invoice',
        'update',
        '${invoiceId}',
        99,
        '{"number":"different replay body"}'
      ) as response
    `)
    if (JSON.stringify(result.rows[0].response) !== JSON.stringify(legacyConflictResponse)) {
      throw new Error('rebound legacy conflict changed after canonical deletion')
    }
  })

  for (const replayKind of ['update', 'delete']) {
    await verify(`an unbound migration-002 conflict fails closed for ${replayKind} replay`, async () => {
      await expectSqlState(
        () => db.query(`
          select public.apply_entity_mutation(
            '${unboundLegacyConflictMutationId}',
            'invoice',
            '${replayKind}',
            '${invoiceId}',
            1,
            '{}'
          )
        `),
        '22023',
      )
    })
  }

  for (const [label, mutationId] of [
    ['a raw invoice receipt with a JSON-null number fails closed', nullNumberMutationId],
    [
      'a raw invoice receipt with JSON-null payment terms fails closed',
      nullPaymentTermsMutationId,
    ],
    ['a raw invoice receipt missing status fails closed', missingStatusMutationId],
  ]) {
    await verify(label, async () => {
      await expectSqlState(
        () =>
          db.query(`
            select public.apply_entity_mutation(
              '${mutationId}',
              'invoice',
              'update',
              '${invoiceId}',
              1,
              '{}'
            )
          `),
        '22023',
      )
    })
  }

  let legacyRepairResponse
  await verify(
    'an exact raw migration-002 invoice receipt requests safe feed repair',
    async () => {
      const result = await db.query(`
        select public.apply_entity_mutation(
          '${legacyMutationId}',
          'invoice',
          'update',
          '${invoiceId}',
          1,
          '{"number":"duplicate replay body"}'
        ) as response
      `)
      const response = result.rows[0].response
      legacyRepairResponse = response

      if (response.repair_from_feed !== true || response.cloud !== null) {
        throw new Error(`repair response was ${JSON.stringify(response)}`)
      }
      if (
        response.sync_position?.source !== 'legacy_receipt' ||
        Number(response.sync_position?.change_id) !== 0
      ) {
        throw new Error(
          `repair position was ${JSON.stringify(response.sync_position ?? null)}`,
        )
      }
    },
  )

  await verify('the legacy repair response is byte-stable on replay', async () => {
    const result = await db.query(`
      select public.apply_entity_mutation(
        '${legacyMutationId}',
        'invoice',
        'update',
        '${invoiceId}',
        99,
        '{"number":"different duplicate body"}'
      ) as response
    `)
    if (JSON.stringify(result.rows[0].response) !== JSON.stringify(legacyRepairResponse)) {
      throw new Error('repair receipt changed on replay')
    }
  })

  await db.exec(`
    update public.mutation_receipts
    set response = jsonb_set(response, '{sync_position}', '{}'::jsonb)
    where user_id = '${ownerId}' and mutation_id = '${legacyMutationId}';
  `)
  await verify('a stored repair receipt with an empty position fails closed', async () => {
    await expectSqlState(
      () =>
        db.query(`
          select public.apply_entity_mutation(
            '${legacyMutationId}',
            'invoice',
            'update',
            '${invoiceId}',
            1,
            '{}'
          )
        `),
      '22023',
    )
  })

  let createdClientResponse
  await verify(
    'a generic receipt identifies exactly one immutable mutation event and restores its GUC',
    async () => {
      await db.exec(
        `select set_config('fieldcraft.mutation_id', '${sentinelMutationId}', false)`,
      )
      const result = await db.query(`
        select public.apply_entity_mutation(
          '${createMutationId}',
          'client',
          'create',
          '${createdClientId}',
          null,
          '{"name":"Positioned client"}'
        ) as response
      `)
      const response = result.rows[0].response
      createdClientResponse = response
      const changeId = Number(response.sync_position?.change_id)

      if (!Number.isInteger(changeId)) {
        throw new Error(
          `receipt position was ${JSON.stringify(response.sync_position ?? null)}`,
        )
      }
      const match = await db.query(
        `
          select count(*)::int as count
          from public.sync_changes
          where user_id = $1
            and mutation_id = $2
            and entity = 'client'
            and entity_id = $3
            and change_id = $4
        `,
        [ownerId, createMutationId, createdClientId, changeId],
      )
      if (match.rows[0].count !== 1) {
        throw new Error('receipt position did not identify exactly one mutation event')
      }

      const setting = await db.query(
        `select current_setting('fieldcraft.mutation_id', true) as mutation_id`,
      )
      if (setting.rows[0].mutation_id !== sentinelMutationId) {
        throw new Error(`mutation GUC leaked as ${setting.rows[0].mutation_id}`)
      }
    },
  )

  await verify(
    'a delete receipt timestamp equals its immutable sync position',
    async () => {
      const result = await db.query(`
        select public.apply_entity_mutation(
          '${deleteMutationId}',
          'client',
          'delete',
          '${createdClientId}',
          ${createdClientResponse?.cloud?.version ?? 1},
          '{}'
        ) as response
      `)
      const response = result.rows[0].response
      if (
        new Date(response.deleted_at).getTime() !==
        new Date(response.sync_position?.updated_at).getTime()
      ) {
        throw new Error(
          `delete timestamp ${response.deleted_at} did not match ` +
            JSON.stringify(response.sync_position),
        )
      }
    },
  )

  await verify('unserialized canonical writes fail closed', async () => {
    await expectSqlState(
      () => db.exec(`
        insert into public.clients (id, user_id, name)
        values ('${directClientId}', '${ownerId}', 'Unserialized client')
      `),
      '55000',
    )
  })

  await verify('an explicitly serialized maintenance write is untagged and contiguous', async () => {
    const before = await db.query(
      `select last_change_seq from public.sync_owner_counters where user_id = $1`,
      [ownerId],
    )
    await db.exec(`
      begin;
      select public.fieldcraft_lock_sync_owner('${ownerId}', null);
      insert into public.clients (id, user_id, name)
      values ('${directClientId}', '${ownerId}', 'Serialized client');
      commit;
    `)
    const result = await db.query(
      `
        select mutation_id, change_seq
        from public.sync_changes
        where user_id = $1
          and entity = 'client'
          and entity_id = $2
        order by change_seq desc
        limit 1
      `,
      [ownerId, directClientId],
    )
    if (
      result.rows[0]?.mutation_id !== null ||
      Number(result.rows[0]?.change_seq) !== Number(before.rows[0].last_change_seq) + 1
    ) {
      throw new Error(`maintenance event was ${JSON.stringify(result.rows[0] ?? null)}`)
    }
  })

  await verify('an unlocked canonical delete fails closed while its owner still exists', async () => {
    await expectSqlState(
      () => db.exec(`delete from public.clients where id = '${directClientId}'`),
      '55000',
    )
    const result = await db.query(
      'select count(*)::int as count from public.clients where id = $1',
      [directClientId],
    )
    if (result.rows[0].count !== 1) throw new Error('unlocked delete changed canonical state')
  })

  await verify('a serialized entity identity rewrite is rejected atomically', async () => {
    await db.exec(`begin; select public.fieldcraft_lock_sync_owner('${ownerId}', null)`)
    try {
      await expectSqlState(
        () => db.exec(`
          update public.clients
          set id = '${rewrittenClientId}'
          where user_id = '${ownerId}' and id = '${directClientId}'
        `),
        '22023',
      )
    } finally {
      await db.exec('rollback')
    }
    const result = await db.query(
      'select id from public.clients where user_id = $1 and id in ($2, $3)',
      [ownerId, directClientId, rewrittenClientId],
    )
    if (result.rows.length !== 1 || result.rows[0].id !== directClientId) {
      throw new Error(`identity rewrite state was ${JSON.stringify(result.rows)}`)
    }
  })

  await verify('a rolled-back writer transaction consumes no owner sequence', async () => {
    const before = await db.query(
      `select last_change_seq from public.sync_owner_counters where user_id = $1`,
      [ownerId],
    )
    await db.exec(`begin; select public.fieldcraft_lock_sync_owner('${ownerId}', null)`)
    await db.exec(`
      update public.clients set name = 'Rolled back client'
      where user_id = '${ownerId}' and id = '${directClientId}'
    `)
    await db.exec('rollback')
    const after = await db.query(`
      select counter.last_change_seq,
             client.name,
             max(change.change_seq) as max_change_seq
      from public.sync_owner_counters as counter
      join public.clients as client on client.user_id = counter.user_id
      left join public.sync_changes as change on change.user_id = counter.user_id
      where counter.user_id = $1 and client.id = $2
      group by counter.last_change_seq, client.name
    `, [ownerId, directClientId])
    if (
      Number(after.rows[0].last_change_seq) !== Number(before.rows[0].last_change_seq) ||
      Number(after.rows[0].max_change_seq) !== Number(before.rows[0].last_change_seq) ||
      after.rows[0].name !== 'Serialized client'
    ) {
      throw new Error(`rollback state was ${JSON.stringify(after.rows[0] ?? null)}`)
    }
  })

  await verify('generic conflicts carry exact immutable present and absence authority', async () => {
    const present = await db.query(`
      select public.apply_entity_mutation(
        '${conflictMutationId}', 'client', 'create', '${directClientId}', null,
        '{"name":"Conflicting local create"}'
      ) as response
    `)
    const presentResponse = present.rows[0].response
    if (
      presentResponse.status !== 'conflict' ||
      presentResponse.sync_position?.source !== 'sync_changes' ||
      Number(presentResponse.sync_position?.change_seq) <= 0 ||
      Number(presentResponse.sync_position?.change_id) <= 0
    ) {
      throw new Error(`present conflict was ${JSON.stringify(presentResponse)}`)
    }

    const missingId = '76000000-0000-0000-0000-000000000099'
    const absent = await db.query(`
      select public.apply_entity_mutation(
        '${absentConflictMutationId}', 'client', 'update', '${missingId}', 1,
        '{"name":"Missing cloud client"}'
      ) as response
    `)
    const absentResponse = absent.rows[0].response
    if (
      absentResponse.status !== 'conflict' ||
      absentResponse.cloud_payload !== null ||
      absentResponse.sync_position?.source !== 'sync_snapshot' ||
      Number(absentResponse.sync_position?.change_id) !== 0
    ) {
      throw new Error(`absence conflict was ${JSON.stringify(absentResponse)}`)
    }

    await db.exec(`
      begin;
      select public.fieldcraft_lock_sync_owner('${ownerId}', null);
      update public.clients set name = 'Later serialized client'
      where user_id = '${ownerId}' and id = '${directClientId}';
      commit;
    `)
    const replay = await db.query(`
      select public.apply_entity_mutation(
        '${absentConflictMutationId}', 'client', 'update', '${missingId}', 99,
        '{"name":"Different replay body"}'
      ) as response
    `)
    if (JSON.stringify(replay.rows[0].response) !== JSON.stringify(absentResponse)) {
      throw new Error('stored absence authority changed after the owner head advanced')
    }
  })

  await verify('bundle receipts use consecutive sequences and conflicts position every member', async () => {
    const payload = `{
      "client":{"id":"${bundleClientId}","name":"Bundle client","baseVersion":0},
      "job":{"id":"${bundleJobId}","clientId":"${bundleClientId}","title":"Bundle job","tradeType":"General","status":"Invoiced","baseVersion":0},
      "invoice":{"id":"${bundleInvoiceId}","clientId":"${bundleClientId}","jobId":"${bundleJobId}","number":"SEQ-1","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft","baseVersion":0}
    }`
    const applied = await db.query(
      `select public.save_invoice_bundle($1, $2::jsonb) as response`,
      [bundleMutationId, payload],
    )
    const appliedResponse = applied.rows[0].response
    const sequences = ['client', 'job', 'invoice'].map(
      (entity) => Number(appliedResponse.sync_positions?.[entity]?.change_seq),
    )
    if (
      appliedResponse.status !== 'applied' ||
      sequences.some((value) => !Number.isSafeInteger(value)) ||
      sequences[1] !== sequences[0] + 1 ||
      sequences[2] !== sequences[1] + 1
    ) {
      throw new Error(`bundle positions were ${JSON.stringify(appliedResponse.sync_positions ?? null)}`)
    }

    const conflict = await db.query(
      `select public.save_invoice_bundle($1, $2::jsonb) as response`,
      [bundleConflictMutationId, payload],
    )
    const conflictResponse = conflict.rows[0].response
    if (
      conflictResponse.status !== 'conflict' ||
      ['client', 'job', 'invoice'].some((entity) =>
        conflictResponse.sync_positions?.[entity]?.source !== 'sync_changes'
      )
    ) {
      throw new Error(`bundle conflict was ${JSON.stringify(conflictResponse)}`)
    }
  })

  await verify('AAL2 enforcement rejects missing and aal1 claims and permits aal2', async () => {
    await db.exec(`select set_config('request.jwt.claims', '', false)`)
    await expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    )
    await db.exec(`select set_config('request.jwt.claims', '{"aal":"aal1"}', false)`)
    await expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    )
    await db.exec(`select set_config('request.jwt.claims', '{"aal":"aal2"}', false)`)
    await db.query('select public.fieldcraft_require_aal2()')
  })

  await verify('onboarding receipt replay and pull preserve the complete profile', async () => {
    const mutationId = '7a000000-0000-4000-8000-000000000071'
    const completedAt = '2026-08-07T18:00:00.000Z'
    const payload = {
      id: ownerId,
      ownerId,
      displayName: 'Avi Builder',
      businessName: 'FieldCraft Plumbing',
      tradeType: 'Plumbing',
      hourlyRateCents: 12550,
      taxBasisPoints: 875,
      paymentTerms: 'Net 30',
      countryCode: 'US',
      currency: 'USD',
      timeZone: 'America/Los_Angeles',
      onboardingVersion: 1,
      onboardingCompletedAt: completedAt,
      version: 0,
      createdAt: completedAt,
      updatedAt: completedAt,
      syncState: 'pending',
    }
    const first = await db.query(
      'select public.save_fieldcraft_onboarding($1, $2::jsonb) as response',
      [mutationId, JSON.stringify(payload)],
    )
    const replay = await db.query(
      'select public.save_fieldcraft_onboarding($1, $2::jsonb) as response',
      [mutationId, JSON.stringify({ ...payload, displayName: 'Different replay body' })],
    )
    const response = first.rows[0].response
    if (
      JSON.stringify(response) !== JSON.stringify(replay.rows[0].response) ||
      response.status !== 'applied' ||
      response.entity !== 'profile' ||
      response.entity_id !== ownerId ||
      response.cloud?.display_name !== payload.displayName ||
      response.cloud?.business_name !== payload.businessName ||
      response.cloud?.trade_type !== payload.tradeType ||
      Number(response.cloud?.hourly_rate_cents) !== payload.hourlyRateCents ||
      Number(response.cloud?.tax_basis_points) !== payload.taxBasisPoints ||
      response.cloud?.payment_terms !== payload.paymentTerms ||
      response.cloud?.country_code !== payload.countryCode ||
      response.cloud?.currency !== payload.currency ||
      response.cloud?.time_zone !== payload.timeZone ||
      Number(response.cloud?.onboarding_version) !== 1 ||
      new Date(response.cloud?.onboarding_completed_at).toISOString() !== completedAt ||
      response.sync_position?.source !== 'sync_changes'
    ) {
      throw new Error(`onboarding response was ${JSON.stringify(response)}`)
    }
    const pulled = await db.query(
      'select public.pull_sync_changes($1, 500) as response',
      [Number(response.sync_position.change_seq) - 1],
    )
    const profileChange = pulled.rows[0].response.changes.find(
      (change) => change.entity === 'profile' && change.entity_id === ownerId,
    )
    if (
      profileChange?.payload?.display_name !== payload.displayName ||
      profileChange?.payload?.time_zone !== payload.timeZone ||
      Number(profileChange?.payload?.onboarding_version) !== 1
    ) {
      throw new Error(`onboarding pull was ${JSON.stringify(profileChange ?? null)}`)
    }
  })

  await verify('onboarding execution grants deny public-only and anon roles', async () => {
    const dummyPayload = JSON.stringify({ id: ownerId, ownerId })
    await withRole('public_client', () => expectSqlState(
      () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
        [roleOnboardingMutationId, dummyPayload],
      ),
      '42501',
    ))
    await withRole('anon', () => expectSqlState(
      () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
        [roleOnboardingMutationId, dummyPayload],
      ),
      '42501',
    ))
  })

  await verify('onboarding security definer uses only the trusted pg_catalog search path', async () => {
    const result = await db.query(`
      select procedure.prosecdef, procedure.proconfig
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname = 'save_fieldcraft_onboarding'
    `)
    const row = result.rows[0]
    if (
      row?.prosecdef !== true ||
      !Array.isArray(row.proconfig) ||
      row.proconfig.length !== 1 ||
      row.proconfig[0] !== 'search_path=pg_catalog'
    ) {
      throw new Error(`onboarding function configuration was ${JSON.stringify(row ?? null)}`)
    }
  })

  await verify('authenticated onboarding rejects missing identity, cross-owner, and malformed payloads', async () => {
    const completedAt = '2026-08-07T18:00:00.000Z'
    const validPayload = {
      id: ownerId,
      ownerId,
      displayName: 'Avi Builder',
      businessName: 'FieldCraft Plumbing',
      tradeType: 'Plumbing',
      hourlyRateCents: 12550,
      taxBasisPoints: 875,
      paymentTerms: 'Net 30',
      countryCode: 'US',
      currency: 'USD',
      timeZone: 'America/Los_Angeles',
      onboardingVersion: 1,
      onboardingCompletedAt: completedAt,
      version: 0,
      createdAt: completedAt,
      updatedAt: completedAt,
      syncState: 'pending',
    }

    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
        [roleOnboardingMutationId, JSON.stringify(validPayload)],
      ),
      '42501',
    ))

    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
        [roleOnboardingMutationId, JSON.stringify({ ...validPayload, ownerId: secondOwnerId })],
      ),
      '42501',
    ))

    const maliciousPayloads = [
      { ...validPayload, displayName: ' Avi Builder' },
      { ...validPayload, displayName: ' ' },
      { ...validPayload, businessName: 'FieldCraft Plumbing ' },
      { ...validPayload, tradeType: 'Software' },
      { ...validPayload, hourlyRateCents: 0 },
      { ...validPayload, hourlyRateCents: 100000001 },
      { ...validPayload, taxBasisPoints: 10001 },
      { ...validPayload, taxBasisPoints: 1.5 },
      { ...validPayload, paymentTerms: 'Net 60' },
      { ...validPayload, countryCode: 'CA' },
      { ...validPayload, currency: 'CAD' },
      { ...validPayload, timeZone: ' America/Los_Angeles' },
      { ...validPayload, timeZone: 'A'.repeat(101) },
      { ...validPayload, onboardingCompletedAt: '2026-08-07T11:00:00-07:00' },
      { ...validPayload, onboardingCompletedAt: '2026-08-07T18:00:00Z' },
      { ...validPayload, onboardingCompletedAt: '2026-02-31T18:00:00.000Z' },
      { ...validPayload, createdAt: '2026-08-07T18:00:00.001Z' },
      { ...validPayload, updatedAt: '2026-08-07T18:00:00.001Z' },
      { ...validPayload, version: 1 },
      { ...validPayload, syncState: 'current' },
      { ...validPayload, administrator: true },
    ]
    for (const [index, payload] of maliciousPayloads.entries()) {
      const mutationId = `7b000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      await withRole('authenticated', () => expectSqlState(
        () => db.query(
          'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
          [mutationId, JSON.stringify(payload)],
        ),
        '22023',
      ))
    }
  })

  await verify('authenticated onboarding applies and replays under owner RLS', async () => {
    const completedAt = '2026-08-07T18:00:00.000Z'
    const payload = {
      id: ownerId,
      ownerId,
      displayName: 'Role Tested Owner',
      businessName: 'Role Tested Business',
      tradeType: 'General',
      hourlyRateCents: 15000,
      taxBasisPoints: 900,
      paymentTerms: 'Due on receipt',
      countryCode: 'US',
      currency: 'USD',
      timeZone: 'America/Los_Angeles',
      onboardingVersion: 1,
      onboardingCompletedAt: completedAt,
      version: 0,
      createdAt: completedAt,
      updatedAt: completedAt,
      syncState: 'pending',
    }
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    await withRole('authenticated', async () => {
      const first = await db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb) as response',
        [roleOnboardingMutationId, JSON.stringify(payload)],
      )
      const replay = await db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb) as response',
        [roleOnboardingMutationId, JSON.stringify({ ...payload, displayName: 'Replay differs' })],
      )
      if (JSON.stringify(first.rows[0].response) !== JSON.stringify(replay.rows[0].response)) {
        throw new Error('authenticated onboarding replay changed its immutable receipt')
      }
    })
  })

  await verify('authenticated direct DML is isolated to owner reads and cannot bypass RPC writes', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    await withRole('authenticated', async () => {
      const visible = await db.query(
        'select id from public.profiles where id in ($1, $2) order by id',
        [ownerId, secondOwnerId],
      )
      if (visible.rows.length !== 1 || visible.rows[0].id !== ownerId) {
        throw new Error(`RLS exposed profiles ${JSON.stringify(visible.rows)}`)
      }
      await expectSqlState(
        () => db.query(
          `insert into public.clients (id, user_id, name) values ($1, $2, 'Bypass')`,
          ['7c000000-0000-4000-8000-000000000001', ownerId],
        ),
        '42501',
      )
      await expectSqlState(
        () => db.query(`update public.profiles set display_name = 'Bypass' where id = $1`, [ownerId]),
        '42501',
      )
    })
  })

  await verify('deleting the auth owner cascades canonical and synchronization state', async () => {
    await db.exec(`delete from auth.users where id = '${ownerId}'`)
    const result = await db.query(`
      select
        (select count(*) from auth.users where id = $1)::int as users,
        (select count(*) from public.clients where user_id = $1)::int as clients,
        (select count(*) from public.sync_owner_counters where user_id = $1)::int as counters,
        (select count(*) from public.sync_changes where user_id = $1)::int as changes,
        (select count(*) from public.mutation_receipts where user_id = $1)::int as receipts
    `, [ownerId])
    if (Object.values(result.rows[0]).some((count) => count !== 0)) {
      throw new Error(`owner cascade left state ${JSON.stringify(result.rows[0])}`)
    }
  })
} finally {
  await db.close()
}

if (failures.length > 0) {
  throw new Error(`FieldCraft PGlite verification failed:\n${failures.join('\n')}`)
}

process.stdout.write(`FieldCraft PGlite verification passed (${checks} checks).\n`)
