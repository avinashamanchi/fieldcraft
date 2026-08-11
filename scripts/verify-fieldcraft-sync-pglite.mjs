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
const lifecycleOwnerId = '83000000-0000-4000-8000-000000000001'
const lifecycleClientId = '83100000-0000-4000-8000-000000000001'
const lifecycleEstimateId = '83200000-0000-4000-8000-000000000001'
const lifecycleJobId = '83300000-0000-4000-8000-000000000001'
const lifecycleInvoiceId = '83400000-0000-4000-8000-000000000001'
const lifecycleManualPaymentId = '83500000-0000-4000-8000-000000000001'
const lifecycleProviderPaymentId = '83500000-0000-4000-8000-000000000002'

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

const expectSqlStateIn = async (operation, expectedCodes) => {
  try {
    await operation()
  } catch (error) {
    if (error && typeof error === 'object' && expectedCodes.includes(error.code)) return
    throw error
  }
  throw new Error(`expected one of SQLSTATE ${expectedCodes.join(', ')}`)
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
    create role service_role bypassrls;
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
  await db.exec(await readMigration('202608070002_fieldcraft_entitlements.sql'))
  await db.exec(await readMigration('202608070003_fieldcraft_business_lifecycle.sql'))
  await db.exec(await readMigration('202608070004_fieldcraft_sync_retention.sql'))
  await db.exec(await readMigration('202608070005_fieldcraft_pro_services.sql'))
  await db.exec(await readMigration('202608070006_fieldcraft_observability.sql'))
  // Supabase grants its service role platform-level table and sequence access.
  // Model that runtime privilege here without changing production migrations or
  // granting user-facing RPCs that the migration intentionally withholds.
  await db.exec(`
    grant usage on schema public to service_role;
    grant select, insert, update, delete on all tables in schema public to service_role;
    grant usage, select, update on all sequences in schema public to service_role;
  `)
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${ownerId}', false)`,
  )

  await verify('AI rate limits are atomic and independently scoped', async () => {
    const userDigest = 'a'.repeat(64)
    const networkDigest = 'b'.repeat(64)
    const { first, second, independent } = await withRole('service_role', async () => ({
      first: await db.query(
        'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
        [userDigest, 'invoice.parse.v1', 1],
      ),
      second: await db.query(
        'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
        [userDigest, 'invoice.parse.v1', 1],
      ),
      independent: await db.query(
        'select * from public.consume_fieldcraft_ai_rate_limit($1, $2, $3)',
        [networkDigest, 'invoice.parse.v1', 1],
      ),
    }))
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

  await verify('AAL2 execution and claims are enforced for every runtime role', async () => {
    const privileges = await db.query(`
      select
        has_function_privilege('public_client', 'public.fieldcraft_require_aal2()', 'execute') as public_only,
        has_function_privilege('anon', 'public.fieldcraft_require_aal2()', 'execute') as anon,
        has_function_privilege('authenticated', 'public.fieldcraft_require_aal2()', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.fieldcraft_require_aal2()', 'execute') as service_role
    `)
    const expectedPrivileges = {
      public_only: false,
      anon: false,
      authenticated: true,
      service_role: false,
    }
    if (JSON.stringify(privileges.rows[0]) !== JSON.stringify(expectedPrivileges)) {
      throw new Error(`AAL2 privileges were ${JSON.stringify(privileges.rows[0])}`)
    }

    for (const role of ['public_client', 'anon', 'service_role']) {
      for (const claims of ['', '{"aal":"aal1"}', '{"aal":"aal2"}']) {
        await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
        await withRole(role, () => expectSqlState(
          () => db.query('select public.fieldcraft_require_aal2()'),
          '42501',
        ))
      }
    }

    await db.exec(`select set_config('request.jwt.claims', '', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    ))
    await db.exec(`select set_config('request.jwt.claims', '{"aal":"aal1"}', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    ))
    await db.exec(`select set_config('request.jwt.claims', '{"aal":"aal2"}', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    ))

    const nowSeconds = Math.floor(Date.now() / 1000)
    const staleClaims = JSON.stringify({
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: nowSeconds - 901 }],
    })
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [staleClaims])
    await withRole('authenticated', () => expectSqlState(
      () => db.query('select public.fieldcraft_require_aal2()'),
      '42501',
    ))

    const recentClaims = JSON.stringify({
      aal: 'aal2',
      amr: [
        { method: 'totp', timestamp: nowSeconds - 1_800 },
        { method: 'password', timestamp: nowSeconds },
        { method: 'totp', timestamp: nowSeconds - 30 },
      ],
    })
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [recentClaims])
    await withRole('authenticated', () => db.query('select public.fieldcraft_require_aal2()'))
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

  await verify('a fresh or late-device onboarding mutation cannot overwrite a completed profile', async () => {
    const lateMutationId = '7a000000-0000-4000-8000-000000000099'
    const completedAt = '2026-08-07T18:01:00.000Z'
    const profileBefore = await db.query(
      'select to_jsonb(profile) as profile from public.profiles as profile where id = $1',
      [ownerId],
    )
    const receiptsBefore = await db.query(
      'select count(*)::int as count from public.mutation_receipts where user_id = $1',
      [ownerId],
    )
    const payload = {
      id: ownerId,
      ownerId,
      displayName: 'Late Device Override',
      businessName: 'Should Never Persist',
      tradeType: 'General',
      hourlyRateCents: 1,
      taxBasisPoints: 0,
      paymentTerms: 'Due on receipt',
      countryCode: 'US',
      currency: 'USD',
      timeZone: 'UTC',
      onboardingVersion: 1,
      onboardingCompletedAt: completedAt,
      version: 0,
      createdAt: completedAt,
      updatedAt: completedAt,
      syncState: 'pending',
    }
    await expectSqlState(
      () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
        [lateMutationId, JSON.stringify(payload)],
      ),
      '23505',
    )
    const after = await db.query(`
      select
        (select to_jsonb(profile) from public.profiles as profile where id = $1) as profile,
        (select count(*)::int from public.mutation_receipts where user_id = $1) as receipts,
        (select count(*)::int from public.mutation_receipts
          where user_id = $1 and mutation_id = $2) as late_receipts
    `, [ownerId, lateMutationId])
    if (
      JSON.stringify(after.rows[0]?.profile) !== JSON.stringify(profileBefore.rows[0]?.profile) ||
      after.rows[0]?.receipts !== receiptsBefore.rows[0]?.count ||
      after.rows[0]?.late_receipts !== 0
    ) {
      throw new Error(`late onboarding changed durable state ${JSON.stringify(after.rows[0])}`)
    }
  })

  await verify('onboarding execution grants deny public-only, anon, and service roles', async () => {
    const dummyPayload = JSON.stringify({ id: ownerId, ownerId })
    for (const role of ['public_client', 'anon', 'service_role']) {
      await withRole(role, () => expectSqlState(
        () => db.query(
          'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
          [roleOnboardingMutationId, dummyPayload],
        ),
        '42501',
      ))
    }
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
      { ...validPayload, displayName: '\tAvi Builder' },
      { ...validPayload, displayName: '\u0085Avi Builder' },
      { ...validPayload, displayName: `Avi Builder\uFEFF` },
      { ...validPayload, displayName: ' ' },
      { ...validPayload, businessName: 'FieldCraft Plumbing ' },
      { ...validPayload, businessName: 'FieldCraft Plumbing\n' },
      { ...validPayload, displayName: '😀'.repeat(101) },
      { ...validPayload, businessName: '😀'.repeat(121) },
      { ...validPayload, tradeType: 'Software' },
      { ...validPayload, hourlyRateCents: 0 },
      { ...validPayload, hourlyRateCents: 100000001 },
      { ...validPayload, taxBasisPoints: 10001 },
      { ...validPayload, taxBasisPoints: 1.5 },
      { ...validPayload, paymentTerms: 'Net 60' },
      { ...validPayload, countryCode: 'CA' },
      { ...validPayload, currency: 'CAD' },
      { ...validPayload, timeZone: ' America/Los_Angeles' },
      { ...validPayload, timeZone: '\u00A0America/Los_Angeles' },
      { ...validPayload, timeZone: 'A'.repeat(101) },
      { ...validPayload, timeZone: '😀'.repeat(101) },
      { ...validPayload, onboardingCompletedAt: '2026-08-07T11:00:00-07:00' },
      { ...validPayload, onboardingCompletedAt: '2026-08-07T18:00:00Z' },
      { ...validPayload, onboardingCompletedAt: '2026-02-31T18:00:00.000Z' },
      {
        ...validPayload,
        onboardingCompletedAt: '0000-01-01T00:00:00.000Z',
        createdAt: '0000-01-01T00:00:00.000Z',
        updatedAt: '0000-01-01T00:00:00.000Z',
      },
      { ...validPayload, createdAt: '2026-08-07T18:00:00.001Z' },
      { ...validPayload, updatedAt: '2026-08-07T18:00:00.001Z' },
      { ...validPayload, version: 1 },
      { ...validPayload, syncState: 'current' },
      { ...validPayload, administrator: true },
    ]
    const profileBefore = await db.query(
      'select to_jsonb(profile) as profile from public.profiles as profile where id = $1',
      [ownerId],
    )
    for (const [index, payload] of maliciousPayloads.entries()) {
      const mutationId = `7b000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      await withRole('authenticated', () => expectSqlState(
        () => db.query(
          'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
          [mutationId, JSON.stringify(payload)],
        ),
        '22023',
      ))
      const durableState = await db.query(`
        select
          (select count(*) from public.mutation_receipts
            where user_id = $1 and mutation_id = $2)::int as receipts,
          (select to_jsonb(profile) from public.profiles as profile where id = $1) as profile
      `, [ownerId, mutationId])
      if (
        durableState.rows[0]?.receipts !== 0 ||
        JSON.stringify(durableState.rows[0]?.profile) !== JSON.stringify(profileBefore.rows[0]?.profile)
      ) {
        throw new Error(`rejected payload ${index} wrote ${JSON.stringify(durableState.rows[0])}`)
      }
    }
  })

  await verify('PostgreSQL transport rejects unsyncable onboarding JSON without durable state', async () => {
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
    const transportCases = [
      { ...validPayload, displayName: '😀\u0000😀' },
      { ...validPayload, businessName: 'FieldCraft\uD800' },
      { ...validPayload, timeZone: '\uDC00America/Los_Angeles' },
    ]
    const profileBefore = await db.query(
      'select to_jsonb(profile) as profile from public.profiles as profile where id = $1',
      [ownerId],
    )
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    for (const [index, payload] of transportCases.entries()) {
      const mutationId = `7e000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      await withRole('authenticated', () => expectSqlStateIn(
        () => db.query(
          'select public.save_fieldcraft_onboarding($1, $2::jsonb)',
          [mutationId, JSON.stringify(payload)],
        ),
        ['22P02', '22P05'],
      ))
      const durableState = await db.query(`
        select
          (select count(*) from public.mutation_receipts
            where user_id = $1 and mutation_id = $2)::int as receipts,
          (select to_jsonb(profile) from public.profiles as profile where id = $1) as profile
      `, [ownerId, mutationId])
      if (
        durableState.rows[0]?.receipts !== 0 ||
        JSON.stringify(durableState.rows[0]?.profile) !== JSON.stringify(profileBefore.rows[0]?.profile)
      ) {
        throw new Error(`transport-rejected payload ${index} wrote ${JSON.stringify(durableState.rows[0])}`)
      }
    }
  })

  await verify('authenticated onboarding accepts code-point maxima and timestamp endpoints', async () => {
    const endpoints = [
      '0001-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999Z',
    ]
    for (const [index, completedAt] of endpoints.entries()) {
      const endpointOwnerId = `70000000-0000-4000-8000-${String(index + 80).padStart(12, '0')}`
      await db.query('insert into auth.users (id, email) values ($1, $2)', [
        endpointOwnerId,
        `endpoint-${index}@example.test`,
      ])
      await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [endpointOwnerId])
      const mutationId = `7d000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      const payload = {
        id: endpointOwnerId,
        ownerId: endpointOwnerId,
        displayName: '😀'.repeat(100),
        businessName: '😀'.repeat(120),
        tradeType: 'General',
        hourlyRateCents: 15000,
        taxBasisPoints: 900,
        paymentTerms: 'Due on receipt',
        countryCode: 'US',
        currency: 'USD',
        timeZone: '😀'.repeat(100),
        onboardingVersion: 1,
        onboardingCompletedAt: completedAt,
        version: 0,
        createdAt: completedAt,
        updatedAt: completedAt,
        syncState: 'pending',
      }
      const result = await withRole('authenticated', () => db.query(
        'select public.save_fieldcraft_onboarding($1, $2::jsonb) as response',
        [mutationId, JSON.stringify(payload)],
      ))
      if (
        result.rows[0]?.response?.cloud?.display_name !== payload.displayName ||
        result.rows[0]?.response?.cloud?.business_name !== payload.businessName ||
        result.rows[0]?.response?.cloud?.time_zone !== payload.timeZone
      ) {
        throw new Error(`endpoint response was ${JSON.stringify(result.rows[0]?.response ?? null)}`)
      }
    }
  })

  await verify('authenticated onboarding applies and replays under owner RLS', async () => {
    const completedAt = '2026-08-07T18:00:00.000Z'
    const payload = {
      id: secondOwnerId,
      ownerId: secondOwnerId,
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
    await db.exec(`select set_config('request.jwt.claim.sub', '${secondOwnerId}', false)`)
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

  await verify('entitlement RPC grants and direct-table privileges are least-authority', async () => {
    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.get_my_entitlement()', 'execute') as anon_get,
        has_function_privilege('authenticated', 'public.get_my_entitlement()', 'execute') as owner_get,
        has_function_privilege('service_role', 'public.get_my_entitlement()', 'execute') as service_get,
        has_function_privilege('authenticated', 'public.reserve_feature_admission(uuid,text)', 'execute') as owner_reserve,
        has_function_privilege('service_role', 'public.reserve_feature_admission(uuid,text)', 'execute') as service_reserve,
        has_function_privilege('authenticated', 'public.apply_revenuecat_event(text,uuid,text,text,text,boolean,timestamptz,timestamptz,text)', 'execute') as owner_apply,
        has_function_privilege('service_role', 'public.apply_revenuecat_event(text,uuid,text,text,text,boolean,timestamptz,timestamptz,text)', 'execute') as service_apply,
        has_table_privilege('authenticated', 'public.subscription_entitlements', 'select') as owner_table,
        has_table_privilege('authenticated', 'public.feature_admissions', 'insert') as owner_admission_table
    `)
    const row = privileges.rows[0]
    if (
      row?.anon_get !== false || row?.owner_get !== true || row?.service_get !== false ||
      row?.owner_reserve !== true || row?.service_reserve !== false ||
      row?.owner_apply !== false || row?.service_apply !== true ||
      row?.owner_table !== false || row?.owner_admission_table !== false
    ) throw new Error(`entitlement privileges were ${JSON.stringify(row ?? null)}`)
  })

  await verify('RevenueCat events are atomic, ordered, terminal-aware, and query-time expired', async () => {
    const entitlementOwner = '81000000-0000-4000-8000-000000000001'
    await db.query('insert into auth.users (id, email) values ($1, $2)', [
      entitlementOwner,
      'entitlement-owner@example.test',
    ])
    const apply = async ({
      hash,
      status,
      providerAt,
      eventType,
      expiresAt = '2099-01-01T00:00:00.000Z',
      active = true,
    }) => withRole('service_role', () => db.query(`
      select public.apply_revenuecat_event(
        $1, $2, 'fieldcraft_pro_monthly', 'SANDBOX', $3, $4, $5, $6, $7
      ) as outcome
    `, [hash, entitlementOwner, status, active, expiresAt, providerAt, eventType]))

    const activeHash = '1'.repeat(64)
    let result = await apply({
      hash: activeHash,
      status: 'active',
      providerAt: '2026-08-09T00:00:00.000Z',
      eventType: 'INITIAL_PURCHASE',
    })
    if (result.rows[0]?.outcome !== 'applied') throw new Error('purchase was not applied')
    result = await apply({
      hash: activeHash,
      status: 'active',
      providerAt: '2026-08-09T00:00:00.000Z',
      eventType: 'INITIAL_PURCHASE',
    })
    if (result.rows[0]?.outcome !== 'duplicate') throw new Error('duplicate was not stable')
    result = await apply({
      hash: '2'.repeat(64),
      status: 'expired',
      providerAt: '2026-08-08T00:00:00.000Z',
      eventType: 'EXPIRATION',
      active: false,
    })
    if (result.rows[0]?.outcome !== 'stale') throw new Error('older expiration overwrote state')
    result = await apply({
      hash: '3'.repeat(64),
      status: 'refunded',
      providerAt: '2026-08-09T00:00:00.000Z',
      eventType: 'REFUND',
      active: false,
    })
    if (result.rows[0]?.outcome !== 'applied') throw new Error('equal timestamp refund lost precedence')
    result = await apply({
      hash: '4'.repeat(64),
      status: 'cancelled',
      providerAt: '2026-08-10T00:00:00.000Z',
      eventType: 'CANCELLATION',
      active: true,
    })
    if (result.rows[0]?.outcome !== 'stale') throw new Error('terminal refund was resurrected')
    result = await apply({
      hash: '5'.repeat(64),
      status: 'active',
      providerAt: '2026-08-11T00:00:00.000Z',
      eventType: 'INITIAL_PURCHASE',
    })
    if (result.rows[0]?.outcome !== 'applied') throw new Error('new purchase did not reactivate')

    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [entitlementOwner])
    const current = await withRole('authenticated', () => db.query(
      'select public.get_my_entitlement() as entitlement',
    ))
    if (current.rows[0]?.entitlement?.state !== 'pro') {
      throw new Error(`current entitlement was ${JSON.stringify(current.rows[0]?.entitlement)}`)
    }

    await apply({
      hash: '6'.repeat(64),
      status: 'active',
      providerAt: '2026-08-12T00:00:00.000Z',
      eventType: 'RENEWAL',
      expiresAt: '2000-01-01T00:00:00.000Z',
    })
    const expired = await withRole('authenticated', () => db.query(
      'select public.get_my_entitlement() as entitlement',
    ))
    if (expired.rows[0]?.entitlement?.state !== 'free') {
      throw new Error(`query-time expiry returned ${JSON.stringify(expired.rows[0]?.entitlement)}`)
    }

    const missingOwner = '81000000-0000-4000-8000-000000000099'
    await withRole('service_role', () => expectSqlState(
      () => db.query(`
        select public.apply_revenuecat_event(
          $1, $2, 'fieldcraft_pro_monthly', 'SANDBOX', 'active', true,
          '2099-01-01T00:00:00Z', '2026-08-13T00:00:00Z', 'INITIAL_PURCHASE'
        )
      `, ['7'.repeat(64), missingOwner]),
      '23503',
    ))
    const failedReceipt = await db.query(
      'select count(*)::int as count from public.revenuecat_event_receipts where event_id_hash = $1',
      ['7'.repeat(64)],
    )
    if (failedReceipt.rows[0]?.count !== 0) throw new Error('failed event retained a receipt')
  })

  await verify('feature admissions enforce free boundaries and survive later expiry for one replay-safe write', async () => {
    const admissionOwner = '82000000-0000-4000-8000-000000000001'
    await db.query('insert into auth.users (id, email) values ($1, $2)', [
      admissionOwner,
      'admission-owner@example.test',
    ])
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [admissionOwner])
    for (let index = 0; index < 10; index += 1) {
      const suffix = String(index + 1).padStart(12, '0')
      await withRole('authenticated', () => db.query(`
        select public.apply_entity_mutation(
          $1, 'client', 'create', $2, null, $3::jsonb
        )
      `, [
        `82100000-0000-4000-8000-${suffix}`,
        `82200000-0000-4000-8000-${suffix}`,
        JSON.stringify({ name: `Client ${index + 1}` }),
      ]))
    }
    const deniedMutation = '82300000-0000-4000-8000-000000000001'
    const denied = await withRole('authenticated', () => db.query(
      `select public.reserve_feature_admission($1, 'create-client') as admission`,
      [deniedMutation],
    ))
    if (
      denied.rows[0]?.admission?.allowed !== false ||
      denied.rows[0]?.admission?.reason !== 'FREE_LIMIT' ||
      denied.rows[0]?.admission?.limit !== 10
    ) throw new Error(`free decision was ${JSON.stringify(denied.rows[0]?.admission)}`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query(`
        select public.apply_entity_mutation(
          $1, 'client', 'create', $2, null, $3::jsonb
        )
      `, [
        deniedMutation,
        '82400000-0000-4000-8000-000000000001',
        JSON.stringify({ name: 'Denied client' }),
      ]),
      '42501',
    ))

    await withRole('service_role', () => db.query(`
      select public.apply_revenuecat_event(
        $1, $2, 'fieldcraft_pro_monthly', 'SANDBOX', 'active', true,
        '2099-01-01T00:00:00Z', '2026-08-09T00:00:00Z', 'INITIAL_PURCHASE'
      )
    `, ['8'.repeat(64), admissionOwner]))
    const allowedMutation = '82300000-0000-4000-8000-000000000002'
    const allowed = await withRole('authenticated', () => db.query(
      `select public.reserve_feature_admission($1, 'create-client') as admission`,
      [allowedMutation],
    ))
    if (allowed.rows[0]?.admission?.allowed !== true) {
      throw new Error(`Pro decision was ${JSON.stringify(allowed.rows[0]?.admission)}`)
    }

    await withRole('service_role', () => db.query(`
      select public.apply_revenuecat_event(
        $1, $2, 'fieldcraft_pro_monthly', 'SANDBOX', 'expired', false,
        '2099-01-01T00:00:00Z', '2026-08-10T00:00:00Z', 'EXPIRATION'
      )
    `, ['9'.repeat(64), admissionOwner]))
    const entityId = '82400000-0000-4000-8000-000000000002'
    const first = await withRole('authenticated', () => db.query(`
      select public.apply_entity_mutation(
        $1, 'client', 'create', $2, null, $3::jsonb
      ) as response
    `, [allowedMutation, entityId, JSON.stringify({ name: 'Admitted client' })]))
    const replay = await withRole('authenticated', () => db.query(`
      select public.apply_entity_mutation(
        $1, 'client', 'create', $2, null, $3::jsonb
      ) as response
    `, [allowedMutation, entityId, JSON.stringify({ name: 'Changed replay' })]))
    if (JSON.stringify(first.rows[0]?.response) !== JSON.stringify(replay.rows[0]?.response)) {
      throw new Error('admitted mutation replay changed its receipt')
    }
    await withRole('authenticated', () => expectSqlStateIn(
      () => db.query(`
        select public.apply_entity_mutation(
          $1, 'client', 'create', $2, null, $3::jsonb
        )
      `, [
        allowedMutation,
        '82400000-0000-4000-8000-000000000003',
        JSON.stringify({ name: 'Second business write' }),
      ]),
      ['22023', '42501'],
    ))
    const retained = await db.query(`
      select allowed, used_at is not null as used,
        retained_until >= created_at + interval '400 days' as retained
      from public.feature_admissions
      where user_id = $1 and mutation_id = $2 and feature = 'create-client'
    `, [admissionOwner, allowedMutation])
    if (
      retained.rows[0]?.allowed !== true ||
      retained.rows[0]?.used !== true ||
      retained.rows[0]?.retained !== true
    ) throw new Error(`retained admission was ${JSON.stringify(retained.rows[0] ?? null)}`)
  })

  await verify('closed jobs and draft invoices cannot bypass free limits by changing status', async () => {
    const owner = '82000000-0000-4000-8000-000000000001'
    const clientId = '82200000-0000-4000-8000-000000000001'
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [owner])
    for (let index = 0; index < 3; index += 1) {
      const suffix = String(index + 1).padStart(12, '0')
      await withRole('authenticated', () => db.query(`
        select public.apply_entity_mutation(
          $1, 'job', 'create', $2, null, $3::jsonb
        )
      `, [
        `82500000-0000-4000-8000-${suffix}`,
        `82600000-0000-4000-8000-${suffix}`,
        JSON.stringify({ clientId, title: `Open job ${index + 1}`, tradeType: 'General', status: 'Scheduled' }),
      ]))
    }
    const closedJob = '82600000-0000-4000-8000-000000000004'
    await withRole('authenticated', () => db.query(`
      select public.apply_entity_mutation(
        '82500000-0000-4000-8000-000000000004', 'job', 'create', $1, null,
        $2::jsonb
      )
    `, [closedJob, JSON.stringify({ clientId, title: 'Closed job', tradeType: 'General', status: 'Invoiced' })]))
    await withRole('authenticated', () => expectSqlState(
      () => db.query(`
        select public.apply_entity_mutation(
          '82500000-0000-4000-8000-000000000005', 'job', 'update', $1, 1,
          '{"status":"Scheduled"}'::jsonb
        )
      `, [closedJob]),
      '42501',
    ))

    for (let index = 0; index < 5; index += 1) {
      const suffix = String(index + 1).padStart(12, '0')
      await withRole('authenticated', () => db.query(`
        select public.apply_entity_mutation(
          $1, 'invoice', 'create', $2, null, $3::jsonb
        )
      `, [
        `82700000-0000-4000-8000-${suffix}`,
        `82800000-0000-4000-8000-${suffix}`,
        JSON.stringify({
          clientId,
          number: `LIMIT-${index + 1}`,
          lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
          subtotalCents: 100,
          taxBasisPoints: 0,
          taxCents: 0,
          totalCents: 100,
          paymentTerms: 'Due on receipt',
          status: 'Issued',
        }),
      ]))
    }
    const draftInvoice = '82800000-0000-4000-8000-000000000006'
    await withRole('authenticated', () => db.query(`
      select public.apply_entity_mutation(
        '82700000-0000-4000-8000-000000000006', 'invoice', 'create', $1, null,
        $2::jsonb
      )
    `, [draftInvoice, JSON.stringify({
      clientId,
      number: 'LIMIT-DRAFT',
      lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 100 }],
      subtotalCents: 100,
      taxBasisPoints: 0,
      taxCents: 0,
      totalCents: 100,
      paymentTerms: 'Due on receipt',
      status: 'Draft',
    })]))
    await withRole('authenticated', () => expectSqlState(
      () => db.query(`
        select public.apply_entity_mutation(
          '82700000-0000-4000-8000-000000000007', 'invoice', 'update', $1, 1,
          '{"status":"Issued"}'::jsonb
        )
      `, [draftInvoice]),
      '42501',
    ))
  })

  await db.exec(`
    insert into auth.users (id, email)
    values ('${lifecycleOwnerId}', 'lifecycle-owner@example.test');
    begin;
    select public.fieldcraft_lock_sync_owner('${lifecycleOwnerId}', null);
    insert into public.clients (id, user_id, name)
    values ('${lifecycleClientId}', '${lifecycleOwnerId}', 'Lifecycle client');
    commit;
  `)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [lifecycleOwnerId])

  const estimateBase = {
    id: lifecycleEstimateId,
    ownerId: lifecycleOwnerId,
    clientId: lifecycleClientId,
    revision: 1,
    status: 'Draft',
    title: 'Replace valve',
    scope: 'Replace the failed shutoff valve.',
    lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 10000 }],
    subtotalCents: 10000,
    taxBasisPoints: 825,
    taxCents: 825,
    totalCents: 10825,
    expiresAt: '2026-09-10T20:00:00.000Z',
    version: 0,
    createdAt: '2026-08-10T20:00:00.000Z',
    updatedAt: '2026-08-10T20:00:00.000Z',
    syncState: 'pending',
  }

  let issuedEstimateResponse
  await verify('estimate lifecycle is immutable, transition-checked, idempotent, and conversion-once', async () => {
    const draftMutation = '83600000-0000-4000-8000-000000000001'
    const draft = await withRole('authenticated', () => db.query(
      'select public.save_estimate($1, $2::jsonb) as response',
      [draftMutation, JSON.stringify(estimateBase)],
    ))
    const replay = await withRole('authenticated', () => db.query(
      'select public.save_estimate($1, $2::jsonb) as response',
      [draftMutation, JSON.stringify({ ...estimateBase, title: 'Changed replay body' })],
    ))
    if (
      JSON.stringify(draft.rows[0]?.response) !== JSON.stringify(replay.rows[0]?.response) ||
      draft.rows[0]?.response?.cloud?.status !== 'Draft'
    ) throw new Error('draft receipt replay was not byte-stable')

    const issuedPayload = {
      ...estimateBase,
      version: 1,
      status: 'Issued',
      number: 'EST-1001',
      issuedAt: '2026-08-10T20:00:00.000Z',
    }
    const issued = await withRole('authenticated', () => db.query(
      'select public.save_estimate($1, $2::jsonb) as response',
      ['83600000-0000-4000-8000-000000000002', JSON.stringify(issuedPayload)],
    ))
    issuedEstimateResponse = issued.rows[0]?.response
    if (
      issuedEstimateResponse?.cloud?.status !== 'Issued' ||
      Number(issuedEstimateResponse?.cloud?.version) !== 2 ||
      issuedEstimateResponse?.cloud?.issued_snapshot?.totalCents !== 10825
    ) throw new Error(`issued estimate was ${JSON.stringify(issuedEstimateResponse)}`)

    const acceptedPayload = { ...issuedPayload, version: 2, status: 'Accepted' }
    const accepted = await withRole('authenticated', () => db.query(
      'select public.save_estimate($1, $2::jsonb) as response',
      ['83600000-0000-4000-8000-000000000003', JSON.stringify(acceptedPayload)],
    ))
    if (
      accepted.rows[0]?.response?.cloud?.status !== 'Accepted' ||
      accepted.rows[0]?.response?.cloud?.acceptance_recorded_by !== lifecycleOwnerId
    ) throw new Error(`accepted estimate was ${JSON.stringify(accepted.rows[0]?.response)}`)

    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.save_estimate($1, $2::jsonb)',
        ['83600000-0000-4000-8000-000000000004', JSON.stringify({
          ...acceptedPayload,
          version: 3,
          title: 'Changed after issue',
        })],
      ),
      '22023',
    ))

    const converted = await withRole('authenticated', () => db.query(
      'select public.convert_estimate($1, $2::jsonb) as response',
      ['83600000-0000-4000-8000-000000000005', JSON.stringify({
        estimateId: lifecycleEstimateId,
        jobId: lifecycleJobId,
        baseVersion: 3,
        now: '2026-08-10T21:00:00.000Z',
      })],
    ))
    const conversionReplay = await withRole('authenticated', () => db.query(
      'select public.convert_estimate($1, $2::jsonb) as response',
      ['83600000-0000-4000-8000-000000000005', JSON.stringify({
        estimateId: lifecycleEstimateId,
        jobId: '83300000-0000-4000-8000-000000000099',
        baseVersion: 99,
        now: '2026-08-11T21:00:00.000Z',
      })],
    ))
    if (
      converted.rows[0]?.response?.cloud?.status !== 'Converted' ||
      converted.rows[0]?.response?.cloud_rows?.[0]?.entity !== 'job' ||
      JSON.stringify(converted.rows[0]?.response) !== JSON.stringify(conversionReplay.rows[0]?.response)
    ) throw new Error(`conversion response was ${JSON.stringify(converted.rows[0]?.response)}`)
    await withRole('authenticated', () => expectSqlStateIn(
      () => db.query(
        'select public.convert_estimate($1, $2::jsonb)',
        ['83600000-0000-4000-8000-000000000006', JSON.stringify({
          estimateId: lifecycleEstimateId,
          jobId: '83300000-0000-4000-8000-000000000099',
          baseVersion: 4,
          now: '2026-08-11T21:00:00.000Z',
        })],
      ),
      ['22023', '40001'],
    ))
  })

  await verify('estimate input rejects 101 line items and cross-owner relationships atomically', async () => {
    const receiptCountBefore = await db.query(
      'select count(*)::int as count from public.mutation_receipts where user_id = $1',
      [lifecycleOwnerId],
    )
    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.save_estimate($1, $2::jsonb)',
        ['83600000-0000-4000-8000-000000000007', JSON.stringify({
          ...estimateBase,
          id: '83200000-0000-4000-8000-000000000002',
          lineItems: Array.from({ length: 101 }, (_, index) => ({
            description: `Line ${index + 1}`,
            type: 'labor',
            quantity: 1000,
            unitPriceCents: 1,
          })),
          subtotalCents: 101,
          taxBasisPoints: 0,
          taxCents: 0,
          totalCents: 101,
        })],
      ),
      '22023',
    ))
    await withRole('authenticated', () => expectSqlStateIn(
      () => db.query(
        'select public.save_estimate($1, $2::jsonb)',
        ['83600000-0000-4000-8000-000000000008', JSON.stringify({
          ...estimateBase,
          id: '83200000-0000-4000-8000-000000000003',
          clientId,
        })],
      ),
      ['23503', '42501'],
    ))
    const receiptCountAfter = await db.query(
      'select count(*)::int as count from public.mutation_receipts where user_id = $1',
      [lifecycleOwnerId],
    )
    if (receiptCountAfter.rows[0]?.count !== receiptCountBefore.rows[0]?.count) {
      throw new Error('rejected estimates wrote mutation receipts')
    }
  })

  await verify('invoice issue and manual/provider payments are bounded, AAL2-gated, and replay-safe', async () => {
    const createInvoice = await withRole('authenticated', () => db.query(`
      select public.apply_entity_mutation(
        $1, 'invoice', 'create', $2, null, $3::jsonb
      ) as response
    `, [
      '83700000-0000-4000-8000-000000000001',
      lifecycleInvoiceId,
      JSON.stringify({
        clientId: lifecycleClientId,
        jobId: lifecycleJobId,
        number: 'INV-1001',
        lineItems: [{ description: 'Labor', type: 'labor', quantity: 1000, unitPriceCents: 10000 }],
        subtotalCents: 10000,
        taxBasisPoints: 0,
        taxCents: 0,
        totalCents: 10000,
        paymentTerms: 'Due on receipt',
        status: 'Draft',
      }),
    ]))
    if (createInvoice.rows[0]?.response?.cloud?.status !== 'Draft') {
      throw new Error('invoice draft was not created')
    }
    const issuePayload = {
      invoiceId: lifecycleInvoiceId,
      baseVersion: 1,
      issuedAt: '2026-08-10T22:00:00.000Z',
      dueAt: '2026-08-10T22:00:00.000Z',
    }
    const issued = await withRole('authenticated', () => db.query(
      'select public.issue_invoice($1, $2::jsonb) as response',
      ['83700000-0000-4000-8000-000000000002', JSON.stringify(issuePayload)],
    ))
    const issueReplay = await withRole('authenticated', () => db.query(
      'select public.issue_invoice($1, $2::jsonb) as response',
      ['83700000-0000-4000-8000-000000000002', JSON.stringify({ ...issuePayload, baseVersion: 99 })],
    ))
    if (
      issued.rows[0]?.response?.cloud?.status !== 'Issued' ||
      Number(issued.rows[0]?.response?.cloud?.balance_cents) !== 10000 ||
      JSON.stringify(issued.rows[0]?.response) !== JSON.stringify(issueReplay.rows[0]?.response)
    ) throw new Error(`invoice issue was ${JSON.stringify(issued.rows[0]?.response)}`)

    await db.exec(`select set_config('request.jwt.claims', '{"aal":"aal1"}', false)`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.record_manual_payment($1, $2::jsonb)',
        ['83700000-0000-4000-8000-000000000003', JSON.stringify({
          paymentId: lifecycleManualPaymentId,
          invoiceId: lifecycleInvoiceId,
          amountCents: 2500,
          currency: 'USD',
          method: 'Cash',
          baseVersion: 2,
          recordedAt: '2026-08-10T22:05:00.000Z',
        })],
      ),
      '42501',
    ))
    const nowSeconds = Math.floor(Date.now() / 1000)
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({
      aal: 'aal2',
      amr: [{ method: 'totp', timestamp: nowSeconds - 30 }],
    })])
    const manualPayload = {
      paymentId: lifecycleManualPaymentId,
      invoiceId: lifecycleInvoiceId,
      amountCents: 2500,
      currency: 'USD',
      method: 'Cash',
      note: 'Owner-recorded cash payment',
      baseVersion: 2,
      recordedAt: '2026-08-10T22:05:00.000Z',
    }
    const manual = await withRole('authenticated', () => db.query(
      'select public.record_manual_payment($1, $2::jsonb) as response',
      ['83700000-0000-4000-8000-000000000004', JSON.stringify(manualPayload)],
    ))
    const manualReplay = await withRole('authenticated', () => db.query(
      'select public.record_manual_payment($1, $2::jsonb) as response',
      ['83700000-0000-4000-8000-000000000004', JSON.stringify({ ...manualPayload, amountCents: 1 })],
    ))
    if (
      manual.rows[0]?.response?.cloud?.status !== 'Succeeded' ||
      Number(manual.rows[0]?.response?.cloud_rows?.[0]?.cloud?.paid_cents) !== 2500 ||
      JSON.stringify(manual.rows[0]?.response) !== JSON.stringify(manualReplay.rows[0]?.response)
    ) throw new Error(`manual payment was ${JSON.stringify(manual.rows[0]?.response)}`)
    await withRole('authenticated', () => expectSqlState(
      () => db.query(
        'select public.record_manual_payment($1, $2::jsonb)',
        ['83700000-0000-4000-8000-000000000005', JSON.stringify({
          ...manualPayload,
          paymentId: '83500000-0000-4000-8000-000000000099',
          amountCents: 7501,
          baseVersion: 3,
        })],
      ),
      '22023',
    ))

    const providerPayload = {
      userId: lifecycleOwnerId,
      paymentId: lifecycleProviderPaymentId,
      invoiceId: lifecycleInvoiceId,
      amountCents: 7500,
      refundedCents: 0,
      currency: 'USD',
      status: 'Succeeded',
      providerPaymentIntentId: 'pi_fieldcraft_fixture_1',
      providerChargeId: 'ch_fieldcraft_fixture_1',
      providerEventAt: '2026-08-10T22:10:00.000Z',
    }
    const provider = await withRole('service_role', () => db.query(
      'select public.apply_provider_payment_event($1, $2::jsonb) as response',
      ['evt_fieldcraft_fixture_1', JSON.stringify(providerPayload)],
    ))
    const duplicate = await withRole('service_role', () => db.query(
      'select public.apply_provider_payment_event($1, $2::jsonb) as response',
      ['evt_fieldcraft_fixture_1', JSON.stringify({ ...providerPayload, amountCents: 1 })],
    ))
    if (
      provider.rows[0]?.response?.outcome !== 'applied' ||
      duplicate.rows[0]?.response?.outcome !== 'duplicate'
    ) throw new Error(`provider receipt outcomes were ${JSON.stringify({ provider: provider.rows[0], duplicate: duplicate.rows[0] })}`)
    const paid = await db.query(
      'select paid_cents, balance_cents, status from public.invoices where id = $1',
      [lifecycleInvoiceId],
    )
    if (
      Number(paid.rows[0]?.paid_cents) !== 10000 ||
      Number(paid.rows[0]?.balance_cents) !== 0 ||
      paid.rows[0]?.status !== 'Paid'
    ) throw new Error(`paid projection was ${JSON.stringify(paid.rows[0])}`)

    const refund = await withRole('service_role', () => db.query(
      'select public.apply_provider_payment_event($1, $2::jsonb) as response',
      ['evt_fieldcraft_fixture_2', JSON.stringify({
        ...providerPayload,
        status: 'Partially Refunded',
        refundedCents: 1000,
        providerEventAt: '2026-08-10T22:15:00.000Z',
      })],
    ))
    const refunded = await db.query(
      'select paid_cents, balance_cents, status from public.invoices where id = $1',
      [lifecycleInvoiceId],
    )
    if (
      refund.rows[0]?.response?.outcome !== 'applied' ||
      Number(refunded.rows[0]?.paid_cents) !== 9000 ||
      Number(refunded.rows[0]?.balance_cents) !== 1000 ||
      refunded.rows[0]?.status !== 'Partially Paid'
    ) throw new Error(`refund projection was ${JSON.stringify(refunded.rows[0])}`)
  })

  await verify('lifecycle tables are owner-readable only and provider writes are service-only', async () => {
    const privileges = await db.query(`
      select
        has_function_privilege('anon', 'public.save_estimate(uuid,jsonb)', 'execute') as anon_estimate,
        has_function_privilege('authenticated', 'public.save_estimate(uuid,jsonb)', 'execute') as auth_estimate,
        has_function_privilege('authenticated', 'public.apply_provider_payment_event(text,jsonb)', 'execute') as auth_provider,
        has_function_privilege('service_role', 'public.apply_provider_payment_event(text,jsonb)', 'execute') as service_provider,
        has_table_privilege('authenticated', 'public.payments', 'insert') as auth_insert
    `)
    if (JSON.stringify(privileges.rows[0]) !== JSON.stringify({
      anon_estimate: false,
      auth_estimate: true,
      auth_provider: false,
      service_provider: true,
      auth_insert: false,
    })) throw new Error(`lifecycle privileges were ${JSON.stringify(privileges.rows[0])}`)
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [secondOwnerId])
    const hidden = await withRole('authenticated', () => db.query(
      'select id from public.estimates where id = $1',
      [lifecycleEstimateId],
    ))
    if (hidden.rows.length !== 0) throw new Error('cross-owner estimate was visible')
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

  await verify('service role has platform table access, bypasses RLS, and cannot bypass write integrity', async () => {
    const role = await db.query(`
      select rolbypassrls,
        has_table_privilege('service_role', 'public.profiles', 'select') as can_select,
        has_function_privilege('service_role', 'public.save_fieldcraft_onboarding(uuid, jsonb)', 'execute') as can_onboard
      from pg_catalog.pg_roles where rolname = 'service_role'
    `)
    if (
      role.rows[0]?.rolbypassrls !== true ||
      role.rows[0]?.can_select !== true ||
      role.rows[0]?.can_onboard !== false
    ) {
      throw new Error(`service role contract was ${JSON.stringify(role.rows[0] ?? null)}`)
    }
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    await withRole('service_role', async () => {
      const visible = await db.query(
        'select id from public.profiles where id in ($1, $2) order by id',
        [ownerId, secondOwnerId],
      )
      if (visible.rows.length !== 2) {
        throw new Error(`service role did not bypass RLS: ${JSON.stringify(visible.rows)}`)
      }
      await expectSqlState(
        () => db.query(`update public.profiles set display_name = 'Unserialized' where id = $1`, [ownerId]),
        '55000',
      )
    })
  })

  await verify('retention grants expose snapshot reads to owners and pruning only to service role', async () => {
    const privileges = await db.query(`
      select
        has_function_privilege('authenticated',
          'public.pull_sync_snapshot(bigint,text,text,integer)', 'execute') as can_snapshot,
        has_function_privilege('authenticated',
          'public.prune_fieldcraft_operational_data(timestamptz)', 'execute') as can_prune,
        has_function_privilege('service_role',
          'public.prune_fieldcraft_operational_data(timestamptz)', 'execute') as service_can_prune,
        has_function_privilege('authenticated',
          'public.pull_sync_changes_retained_internal(bigint,integer)', 'execute') as can_internal
    `)
    const row = privileges.rows[0]
    if (
      row?.can_snapshot !== true || row?.can_prune !== false ||
      row?.service_can_prune !== true || row?.can_internal !== false
    ) throw new Error(`retention grants were ${JSON.stringify(row ?? null)}`)
  })

  await verify('a device floor bounds 90-day pruning and an expired cursor receives snapshot recovery', async () => {
    const headResult = await db.query(
      'select last_change_seq from public.sync_owner_counters where user_id = $1',
      [ownerId],
    )
    const head = Number(headResult.rows[0]?.last_change_seq ?? 0)
    if (head < 4) throw new Error(`owner head was unexpectedly ${head}`)
    const deviceCursor = head - 2
    await db.exec(`select set_config('request.jwt.claim.sub', '${ownerId}', false)`)
    await withRole('authenticated', () => db.query(
      'select public.record_fieldcraft_sync_device_cursor($1, $2)',
      ['84000000-0000-4000-8000-000000000001', deviceCursor],
    ))
    await db.query(
      `update public.sync_changes set updated_at = '2025-01-01T00:00:00Z'
       where user_id = $1 and change_seq <= $2`,
      [ownerId, head],
    )
    await withRole('service_role', () => db.query(
      `select public.prune_fieldcraft_operational_data('2026-08-10T12:00:00Z') as response`,
    ))
    const retained = await db.query(
      `select min(change_seq)::bigint as first_seq, max(change_seq)::bigint as last_seq
       from public.sync_changes where user_id = $1`,
      [ownerId],
    )
    if (
      Number(retained.rows[0]?.first_seq) !== deviceCursor + 1 ||
      Number(retained.rows[0]?.last_seq) !== head
    ) throw new Error(`retained range was ${JSON.stringify(retained.rows[0] ?? null)}`)
    const expired = await db.query(
      'select public.pull_sync_changes($1, 200) as response',
      [deviceCursor - 1],
    )
    if (
      expired.rows[0]?.response?.status !== 'cursor_expired' ||
      Number(expired.rows[0]?.response?.snapshot_watermark) !== head
    ) throw new Error(`expired response was ${JSON.stringify(expired.rows[0]?.response ?? null)}`)
    const snapshot = await db.query(
      'select public.pull_sync_snapshot($1, null, null, 1) as response',
      [head],
    )
    const response = snapshot.rows[0]?.response
    if (
      response?.status !== 'ok' || response?.rows?.length !== 1 ||
      Number(response?.snapshot_watermark) !== head ||
      Number(response?.resume_cursor?.change_seq) !== head ||
      response?.rows?.[0]?.owner_id !== ownerId
    ) throw new Error(`snapshot response was ${JSON.stringify(response ?? null)}`)
  })

  await verify('400-day receipts and 30-day content-free events prune at separate boundaries', async () => {
    await withRole('service_role', async () => {
      await db.query(`
        insert into public.fieldcraft_operational_events
          (event_type, outcome, dimensions, occurred_at)
        values
          ('sync_pull', 'ok', '{"route":"sync-pull"}'::jsonb, '2026-06-01T00:00:00Z'),
          ('sync_pull', 'ok', '{"route":"sync-pull"}'::jsonb, '2026-08-01T00:00:00Z')
      `)
      await db.query(
        `select public.prune_fieldcraft_operational_data('2026-08-10T12:00:00Z')`,
      )
    })
    const events = await db.query(
      'select occurred_at from public.fieldcraft_operational_events order by occurred_at',
    )
    if (events.rows.length !== 1 || new Date(events.rows[0].occurred_at).toISOString() !== '2026-08-01T00:00:00.000Z') {
      throw new Error(`operational retention left ${JSON.stringify(events.rows)}`)
    }
    const receiptConstraint = await db.query(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'mutation_receipts_minimum_retention_check'
    `)
    if (!receiptConstraint.rows[0]?.definition.includes("'400 days'")) {
      throw new Error(`receipt retention was ${JSON.stringify(receiptConstraint.rows[0] ?? null)}`)
    }
  })

  await verify('account deletion invalidates new writes and revokes service work before auth removal', async () => {
    const deletionOwnerId = lifecycleOwnerId
    const deletionInvoiceId = lifecycleInvoiceId
    const scheduleId = '84000000-0000-4000-8000-000000000001'
    const deliveryId = '84100000-0000-4000-8000-000000000001'
    await db.exec('begin')
    await db.query('select public.fieldcraft_lock_sync_owner($1, null)', [deletionOwnerId])
    await db.query(`
      insert into public.reminder_schedules (
        id, user_id, invoice_id, recipient_email, has_reminder_consent,
        occurrences
      ) values ($1, $2, $3, 'customer@example.test', true, '["due"]'::jsonb)
    `, [scheduleId, deletionOwnerId, deletionInvoiceId])
    await db.query(`
      insert into public.reminder_deliveries (
        id, user_id, invoice_id, schedule_id, due_occurrence
      ) values ($1, $2, $3, $4, 'due')
    `, [deliveryId, deletionOwnerId, deletionInvoiceId, scheduleId])
    await db.exec('commit')
    await withRole('service_role', async () => {
      await db.query(`
        insert into public.stripe_connected_accounts (
          user_id, connected_account_id, requirements_state
        ) values ($1, 'acct_deletefixture', 'pending')
        on conflict (user_id) do nothing
      `, [deletionOwnerId])
      await db.query(`
        insert into public.invoice_payment_links (
          user_id, invoice_id, token_hash, expires_at
        ) values ($1, $2, decode($3, 'hex'), statement_timestamp() + interval '1 day')
      `, [deletionOwnerId, deletionInvoiceId, 'a'.repeat(64)])
      const firstInvalidation = await db.query('select public.fieldcraft_invalidate_owner_work($1) as generation', [deletionOwnerId])
      const retryInvalidation = await db.query('select public.fieldcraft_invalidate_owner_work($1) as generation', [deletionOwnerId])
      if (Number(firstInvalidation.rows[0]?.generation) !== 1 || Number(retryInvalidation.rows[0]?.generation) !== 1) throw new Error('deletion invalidation was not retry-safe')
      await db.query('select public.fieldcraft_revoke_owner_payment_links($1)', [deletionOwnerId])
      await db.query('select public.fieldcraft_cancel_owner_reminders($1)', [deletionOwnerId])
    })
    await expectSqlState(
      () => db.query('select public.fieldcraft_lock_sync_owner($1, null)', [deletionOwnerId]),
      '42501',
    )
    const state = await db.query(`
      select
        (select generation from public.fieldcraft_owner_deletion_state where user_id = $1) as generation,
        (select revoked_at is not null from public.invoice_payment_links where user_id = $1) as link_revoked,
        (select not active from public.reminder_schedules where id = $2) as reminder_disabled,
        (select status from public.reminder_deliveries where id = $3) as delivery_status
    `, [deletionOwnerId, scheduleId, deliveryId])
    const row = state.rows[0]
    if (
      Number(row?.generation) !== 1 || row?.link_revoked !== true ||
      row?.reminder_disabled !== true || row?.delivery_status !== 'Cancelled'
    ) throw new Error(`deletion state was ${JSON.stringify(row ?? null)}`)
  })

  await verify('operational telemetry is service-only, digest-only, and rejects content fields', async () => {
    const grants = await db.query(`
      select
        has_function_privilege('authenticated', 'public.record_fieldcraft_operational_event(text,text,jsonb,text,integer)', 'execute') as owner_records,
        has_function_privilege('service_role', 'public.record_fieldcraft_operational_event(text,text,jsonb,text,integer)', 'execute') as service_records,
        has_table_privilege('authenticated', 'public.fieldcraft_owner_deletion_state', 'select') as owner_reads_deletion
    `)
    const grant = grants.rows[0]
    if (grant?.owner_records !== false || grant?.service_records !== true || grant?.owner_reads_deletion !== false) {
      throw new Error(`observability grants were ${JSON.stringify(grant ?? null)}`)
    }
    await withRole('service_role', () => db.query(`
      select public.record_fieldcraft_operational_event(
        'account_deletion', 'ok', '{"route":"delete-account","status":"completed"}'::jsonb,
        $1, 1
      )
    `, ['b'.repeat(64)]))
    await withRole('service_role', () => expectSqlState(
      () => db.query(`
        select public.record_fieldcraft_operational_event(
          'sync_failure', 'failed', '{"email":"private@example.test"}'::jsonb,
          null, null
        )
      `),
      '23514',
    ))
  })

  await verify('connected payments expose owner reads while provider mutations remain service-only', async () => {
    const grants = await db.query(`
      select
        has_table_privilege('authenticated', 'public.stripe_connected_accounts', 'select') as owner_reads_account,
        has_table_privilege('authenticated', 'public.stripe_connected_accounts', 'insert') as owner_writes_account,
        has_table_privilege('authenticated', 'public.invoice_payment_links', 'select') as owner_reads_link,
        has_function_privilege('authenticated', 'public.fieldcraft_resolve_payment_link(text)', 'execute') as owner_resolves_public,
        has_function_privilege('service_role', 'public.fieldcraft_resolve_payment_link(text)', 'execute') as service_resolves_public,
        has_function_privilege('authenticated', 'public.fieldcraft_claim_reminders(integer)', 'execute') as owner_claims,
        has_function_privilege('service_role', 'public.fieldcraft_claim_reminders(integer)', 'execute') as service_claims
    `)
    const row = grants.rows[0]
    if (
      row?.owner_reads_account !== true || row?.owner_writes_account !== false ||
      row?.owner_reads_link !== true || row?.owner_resolves_public !== false ||
      row?.service_resolves_public !== true || row?.owner_claims !== false ||
      row?.service_claims !== true
    ) throw new Error(`provider grants were ${JSON.stringify(row ?? null)}`)
    await withRole('service_role', () => expectSqlState(
      () => db.query('select * from public.fieldcraft_claim_reminders(101)'),
      '22023',
    ))
  })

  await verify('payment-link and reminder identities are digest-only, unique, and expiry indexed', async () => {
    const schema = await db.query(`
      select
        (select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'invoice_payment_links'
            and column_name = 'token_hash') as token_type,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'invoice_payment_links_one_active_idx') as active_link_index,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'reminder_delivery_occurrence_idx') as occurrence_index,
        (select count(*)::int from pg_indexes
          where schemaname = 'public' and indexname = 'reminder_delivery_provider_message_idx') as provider_message_index
    `)
    const row = schema.rows[0]
    if (
      row?.token_type !== 'bytea' || row?.active_link_index !== 1 ||
      row?.occurrence_index !== 1 || row?.provider_message_index !== 1
    ) throw new Error(`provider schema was ${JSON.stringify(row ?? null)}`)
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
