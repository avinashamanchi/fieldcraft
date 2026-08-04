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
const nullNumberMutationId = '74000000-0000-0000-0000-000000000074'
const nullPaymentTermsMutationId = '74000000-0000-0000-0000-000000000075'
const missingStatusMutationId = '74000000-0000-0000-0000-000000000076'
const invoiceMutationId = '75000000-0000-0000-0000-000000000073'
const createdInvoiceId = '73000000-0000-0000-0000-000000000073'
const createMutationId = '75000000-0000-0000-0000-000000000071'
const deleteMutationId = '75000000-0000-0000-0000-000000000072'
const createdClientId = '76000000-0000-0000-0000-000000000071'
const directClientId = '76000000-0000-0000-0000-000000000072'
const sentinelMutationId = '77000000-0000-0000-0000-000000000071'

const db = new PGlite()
const failures = []

const verify = async (label, operation) => {
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

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create or replace function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)

  await db.exec(await readMigration('202608030001_fieldcraft_core.sql'))
  await db.exec(await readMigration('202608030002_fieldcraft_functions.sql'))

  // This fixture deliberately creates an invoice before more than one feed page
  // of newer rows and before its current relationship snapshots. Migration 003
  // must make the invoice row self-contained rather than relying on page order.
  await db.exec(`
    insert into auth.users (id, email)
    values ('${ownerId}', 'migration-order@example.test');

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
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${ownerId}', false)`,
  )

  await verify(
    'migration 003 emits a self-contained pre-003 invoice before later relationship rows',
    async () => {
      const result = await db.query(
        'select public.pull_sync_changes(null, null, 500) as response',
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
        await db.exec(`delete from public.invoices where id = '${createdInvoiceId}'`)
      }
    },
  )

  // Once the authoritative feed entities are gone, migration-002 receipts do
  // not contain enough relationship history to reconstruct an invoice safely.
  await db.exec(`
    delete from public.invoices where id = '${invoiceId}';
    delete from public.jobs where id = '${jobId}';
    delete from public.clients where id = '${clientId}';
  `)

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

  await verify('ordinary writes are not tagged with a stale mutation GUC', async () => {
    await db.exec(`
      select set_config('fieldcraft.mutation_id', '', false);
      insert into public.clients (id, user_id, name)
      values ('${directClientId}', '${ownerId}', 'Direct client');
    `)
    const result = await db.query(
      `
        select mutation_id
        from public.sync_changes
        where user_id = $1
          and entity = 'client'
          and entity_id = $2
        order by change_id desc
        limit 1
      `,
      [ownerId, directClientId],
    )
    if (result.rows[0]?.mutation_id !== null) {
      throw new Error(`direct write was tagged ${result.rows[0]?.mutation_id}`)
    }
  })
} finally {
  await db.close()
}

if (failures.length > 0) {
  throw new Error(`FieldCraft PGlite verification failed:\n${failures.join('\n')}`)
}

process.stdout.write(`FieldCraft PGlite verification passed (${11} checks).\n`)
