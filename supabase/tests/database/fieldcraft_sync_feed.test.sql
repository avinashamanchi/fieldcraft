begin;

create extension if not exists pgtap with schema extensions;

select plan(79);

insert into auth.users (id, email)
values
  ('70000000-0000-0000-0000-000000000007', 'sync-a@example.test'),
  ('80000000-0000-0000-0000-000000000008', 'sync-b@example.test');

select has_table('public', 'sync_changes', 'the append-only synchronization feed exists');
select has_function(
  'public',
  'pull_sync_changes',
  array['timestamp with time zone', 'bigint', 'integer'],
  'the cursor RPC has one global updated_at/change_id boundary'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000007","role":"authenticated"}',
  true
);
set local role authenticated;

create temporary table create_response (response jsonb not null) on commit drop;
insert into create_response (response)
select public.apply_entity_mutation(
  '71000000-0000-0000-0000-000000000007',
  'client',
  'create',
  '72000000-0000-0000-0000-000000000007',
  null,
  '{"name":"Feed client"}'
);

select is(
  (select response ->> 'mutation_id' from create_response),
  '71000000-0000-0000-0000-000000000007',
  'applied generic response is bound to its mutation ID'
);
select is(
  (select response ->> 'entity_id' from create_response),
  '72000000-0000-0000-0000-000000000007',
  'applied generic response is bound to its entity ID'
);
select is(
  nullif(current_setting('fieldcraft.mutation_id', true), ''),
  null::text,
  'the generic wrapper restores transaction-local mutation attribution'
);

reset role;
select is(
  (select count(*) from public.sync_changes
   where user_id = '70000000-0000-0000-0000-000000000007'
     and entity = 'client'
     and entity_id = '72000000-0000-0000-0000-000000000007'),
  1::bigint,
  'a generic RPC write transactionally emits one canonical feed entry'
);
select ok(
  (select payload #>> '{name}' = 'Feed client' and deleted = false
   from public.sync_changes
   where entity_id = '72000000-0000-0000-0000-000000000007'),
  'the generic feed entry carries canonical cloud payload'
);

select is(
  (
    select count(*)
    from public.sync_changes as change
    cross join create_response as receipt
    where change.user_id = '70000000-0000-0000-0000-000000000007'
      and change.mutation_id = '71000000-0000-0000-0000-000000000007'
      and change.entity = 'client'
      and change.entity_id = '72000000-0000-0000-0000-000000000007'
      and change.change_id = (receipt.response #>> '{sync_position,change_id}')::bigint
      and change.updated_at = (receipt.response #>> '{sync_position,updated_at}')::timestamptz
  ),
  1::bigint,
  'an applied generic receipt position maps uniquely to its mutation-linked feed event'
);

set local role authenticated;
select is(
  public.apply_entity_mutation(
    '71000000-0000-0000-0000-000000000007',
    'client',
    'create',
    '72000000-0000-0000-0000-000000000007',
    null,
    '{"name":"Ignored replay body"}'
  ) -> 'sync_position',
  (select response -> 'sync_position' from create_response),
  'a generic replay preserves the exact immutable feed position'
);

create temporary table bundle_response (response jsonb not null) on commit drop;
insert into bundle_response (response)
select public.save_invoice_bundle(
  '73000000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","name":"Bundle client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","title":"Bundle job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is(
  (select response ->> 'mutation_id' from bundle_response),
  '73000000-0000-0000-0000-000000000007',
  'applied bundle response is bound to its mutation ID'
);
select is(
  (select response #>> '{entity_ids,invoice}' from bundle_response),
  '76000000-0000-0000-0000-000000000007',
  'applied bundle response binds its canonical invoice ID'
);
select is(
  nullif(current_setting('fieldcraft.mutation_id', true), ''),
  null::text,
  'the bundle wrapper restores transaction-local mutation attribution'
);

reset role;
select is(
  (
    select count(*)
    from jsonb_each((select response -> 'sync_positions' from bundle_response))
      as position(entity, value)
    join public.sync_changes as change
      on change.entity = position.entity
     and change.change_id = (position.value ->> 'change_id')::bigint
     and change.updated_at = (position.value ->> 'updated_at')::timestamptz
     and change.entity_id = case position.entity
       when 'client' then '74000000-0000-0000-0000-000000000007'::uuid
       when 'job' then '75000000-0000-0000-0000-000000000007'::uuid
       when 'invoice' then '76000000-0000-0000-0000-000000000007'::uuid
     end
    where change.user_id = '70000000-0000-0000-0000-000000000007'
      and change.mutation_id = '73000000-0000-0000-0000-000000000007'
  ),
  3::bigint,
  'an applied bundle exposes one mutation-linked feed position for every member'
);

set local role authenticated;
create temporary table generic_invoice_response (response jsonb not null) on commit drop;
insert into generic_invoice_response (response)
select public.apply_entity_mutation(
  '73150000-0000-0000-0000-000000000007',
  'invoice',
  'create',
  '76100000-0000-0000-0000-000000000007',
  null,
  '{
    "clientId":"74000000-0000-0000-0000-000000000007",
    "jobId":"75000000-0000-0000-0000-000000000007",
    "number":"SYNC-GENERIC-001",
    "lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],
    "subtotalCents":100,
    "taxBasisPoints":0,
    "taxCents":0,
    "totalCents":100,
    "paymentTerms":"Due on receipt",
    "status":"Draft"
  }'
);
select is(
  concat_ws(
    '|',
    ((select response from generic_invoice_response) ? 'repair_from_feed')::text,
    (select response #>> '{cloud,clients,name}' from generic_invoice_response),
    (select response #>> '{cloud,jobs,title}' from generic_invoice_response),
    (select response #>> '{sync_position,source}' from generic_invoice_response)
  ),
  'false|Bundle client|Bundle job|sync_changes',
  'a new generic invoice binds self-contained cloud data instead of legacy feed repair'
);
reset role;
select is(
  (
    select count(*)
    from public.sync_changes as change
    cross join generic_invoice_response as receipt
    where change.user_id = '70000000-0000-0000-0000-000000000007'
      and change.mutation_id = '73150000-0000-0000-0000-000000000007'
      and change.entity = 'invoice'
      and change.entity_id = '76100000-0000-0000-0000-000000000007'
      and change.change_id = (receipt.response #>> '{sync_position,change_id}')::bigint
      and change.updated_at = (receipt.response #>> '{sync_position,updated_at}')::timestamptz
  ),
  1::bigint,
  'a new generic invoice receipt position identifies its exact mutation event'
);
delete from public.invoices
where user_id = '70000000-0000-0000-0000-000000000007'
  and id = '76100000-0000-0000-0000-000000000007';
delete from public.sync_changes
where user_id = '70000000-0000-0000-0000-000000000007'
  and entity = 'invoice'
  and entity_id = '76100000-0000-0000-0000-000000000007';
delete from public.mutation_receipts
where user_id = '70000000-0000-0000-0000-000000000007'
  and mutation_id = '73150000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73200000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'client',
    'kind', 'update',
    'entity_id', client.id,
    'cloud', to_jsonb(client)
  )
from public.clients as client
where client.id = '74000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (
  user_id, mutation_id, response, created_at, updated_at
) values (
  '70000000-0000-0000-0000-000000000007',
  '73500000-0000-0000-0000-000000000017',
  '{"status":"applied","entity":"client","kind":"delete","entity_id":"74000000-0000-0000-0000-000000000017","deleted_version":4}',
  '2026-08-03T10:00:01.000Z',
  '2026-08-03T10:00:09.000Z'
);

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73500000-0000-0000-0000-000000000007',
  jsonb_build_object('cloud', to_jsonb(client))
from public.clients as client
where client.id = '74000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73300000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'conflict',
    'entity', 'client',
    'kind', 'update',
    'entity_id', client.id,
    'local_payload', '{"name":"Legacy edit"}'::jsonb,
    'cloud_version', client.version,
    'cloud', to_jsonb(client),
    'cloud_payload', to_jsonb(client)
  )
from public.clients as client
where client.id = '74000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73400000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'client', to_jsonb(client),
    'job', to_jsonb(job),
    'invoice', to_jsonb(invoice)
  )
from public.clients as client
join public.jobs as job on job.user_id = client.user_id and job.client_id = client.id
join public.invoices as invoice
  on invoice.user_id = job.user_id and invoice.client_id = job.client_id and invoice.job_id = job.id
where client.id = '74000000-0000-0000-0000-000000000007'
  and job.id = '75000000-0000-0000-0000-000000000007'
  and invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73600000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'client', to_jsonb(client),
    'job', to_jsonb(job)
  )
from public.clients as client
join public.jobs as job on job.user_id = client.user_id and job.client_id = client.id
where client.id = '74000000-0000-0000-0000-000000000007'
  and job.id = '75000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73700000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', to_jsonb(invoice) || jsonb_build_object(
      'clients', jsonb_build_object('name', client.name),
      'jobs', jsonb_build_object(
        'title', job.title,
        'address', job.address,
        'description', job.description,
        'trade_type', job.trade_type
      )
    )
  )
from public.clients as client
join public.jobs as job on job.user_id = client.user_id and job.client_id = client.id
join public.invoices as invoice
  on invoice.user_id = job.user_id and invoice.client_id = job.client_id and invoice.job_id = job.id
where client.id = '74000000-0000-0000-0000-000000000007'
  and job.id = '75000000-0000-0000-0000-000000000007'
  and invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73800000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', to_jsonb(invoice)
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73840000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', jsonb_set(to_jsonb(invoice), '{number}', 'null'::jsonb)
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73850000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', jsonb_set(to_jsonb(invoice), '{payment_terms}', 'null'::jsonb)
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73860000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', to_jsonb(invoice) - 'status'
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73830000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', jsonb_set(to_jsonb(invoice), '{line_items}', '[]'::jsonb)
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73810000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', jsonb_set(to_jsonb(invoice), '{number}', '"NO-HISTORICAL-MATCH"'::jsonb)
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73820000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'entity', 'invoice',
    'kind', 'update',
    'entity_id', invoice.id,
    'cloud', to_jsonb(invoice) || '{"clients":{"name":""}}'::jsonb
  )
from public.invoices as invoice
where invoice.id = '76000000-0000-0000-0000-000000000007';

insert into public.mutation_receipts (user_id, mutation_id, response)
select
  '70000000-0000-0000-0000-000000000007',
  '73900000-0000-0000-0000-000000000007',
  jsonb_build_object(
    'status', 'applied',
    'client', to_jsonb(client),
    'job', to_jsonb(job),
    'invoice', to_jsonb(invoice)
  )
from public.clients as client
join public.jobs as job on job.user_id = client.user_id and job.client_id = client.id
join public.invoices as invoice
  on invoice.user_id = job.user_id and invoice.client_id = job.client_id and invoice.job_id = job.id
where client.id = '74000000-0000-0000-0000-000000000007'
  and job.id = '75000000-0000-0000-0000-000000000007'
  and invoice.id = '76000000-0000-0000-0000-000000000007';

set local role authenticated;
create temporary table legacy_generic_applied (response jsonb not null) on commit drop;
insert into legacy_generic_applied (response)
select public.apply_entity_mutation(
  '73200000-0000-0000-0000-000000000007',
  'client',
  'update',
  '74000000-0000-0000-0000-000000000007',
  1,
  '{"name":"Legacy applied replay"}'
);
select is(
  (select response ->> 'mutation_id' from legacy_generic_applied),
  '73200000-0000-0000-0000-000000000007',
  'a pre-003 applied generic receipt is bound during replay'
);
select is(
  (select response ->> 'entity_id' from legacy_generic_applied),
  '74000000-0000-0000-0000-000000000007',
  'a legacy applied replay preserves its strict entity identity'
);

create temporary table legacy_generic_conflict (response jsonb not null) on commit drop;
insert into legacy_generic_conflict (response)
select public.apply_entity_mutation(
  '73300000-0000-0000-0000-000000000007',
  'client',
  'update',
  '74000000-0000-0000-0000-000000000007',
  1,
  '{"name":"Legacy conflict replay"}'
);
select is(
  (select response ->> 'mutation_id' from legacy_generic_conflict),
  '73300000-0000-0000-0000-000000000007',
  'a pre-003 generic conflict receipt is bound during replay'
);
select is(
  public.apply_entity_mutation(
    '73300000-0000-0000-0000-000000000007',
    'client',
    'update',
    '74000000-0000-0000-0000-000000000007',
    1,
    '{"changed":true}'
  )::text,
  (select response::text from legacy_generic_conflict),
  'an upgraded legacy generic conflict remains idempotent'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73300000-0000-0000-0000-000000000007',
    'service',
    'update',
    '74000000-0000-0000-0000-000000000007',
    1,
    '{"name":"Wrong entity"}'
  ) $$,
  '22023',
  null,
  'a legacy receipt cannot be replayed against a different entity contract'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73500000-0000-0000-0000-000000000007',
    'client',
    'update',
    '74000000-0000-0000-0000-000000000007',
    1,
    '{"name":"Malformed receipt replay"}'
  ) $$,
  '22023',
  null,
  'a legacy generic receipt without a status is rejected'
);
select is(
  (public.apply_entity_mutation(
    '73500000-0000-0000-0000-000000000017',
    'client',
    'delete',
    '74000000-0000-0000-0000-000000000017',
    4,
    '{}'
  ) ->> 'deleted_at')::timestamptz,
  '2026-08-03T10:00:01.000Z'::timestamptz,
  'a legacy delete binds its immutable receipt creation time instead of replay update time'
);

create temporary table legacy_bundle_applied (response jsonb not null) on commit drop;
insert into legacy_bundle_applied (response)
select public.save_invoice_bundle(
  '73400000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":1,"name":"Bundle client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","title":"Bundle job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is(
  (select response ->> 'mutation_id' from legacy_bundle_applied),
  '73400000-0000-0000-0000-000000000007',
  'a pre-003 applied bundle receipt is bound during replay'
);
select is(
  (select response #>> '{entity_ids,job}' from legacy_bundle_applied),
  '75000000-0000-0000-0000-000000000007',
  'a legacy bundle replay binds every compound member ID'
);
select is(
  public.save_invoice_bundle(
    '73400000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":1,"name":"Bundle client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","title":"Bundle job","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
    }'
  )::text,
  (select response::text from legacy_bundle_applied),
  'an upgraded legacy bundle receipt remains idempotent'
);
select throws_ok(
  $$ select public.save_invoice_bundle(
    '73400000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","name":"Bundle client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000099","title":"Wrong relationship","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
    }'
  ) $$,
  '22023',
  null,
  'a legacy bundle receipt cannot be replayed with broken relationships'
);
select throws_ok(
  $$ select public.save_invoice_bundle(
    '73600000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","name":"Bundle client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007"}
    }'
  ) $$,
  '22023',
  null,
  'a legacy applied bundle receipt missing a member is rejected'
);
select is(
  public.apply_entity_mutation(
    '73100000-0000-0000-0000-000000000007',
    'client',
    'create',
    '74000000-0000-0000-0000-000000000007',
    null,
    '{"name":"Colliding local create"}'
  ) ->> 'status',
  'conflict',
  'a create collision returns structured conflict instead of unique violation'
);
select is(
  public.apply_entity_mutation(
    '73100000-0000-0000-0000-000000000007',
    'client',
    'create',
    '74000000-0000-0000-0000-000000000007',
    null,
    '{"changed":true}'
  ) #>> '{cloud_payload,id}',
  '74000000-0000-0000-0000-000000000007',
  'the create collision replays its canonical SQLite-compatible cloud row'
);
reset role;
select is(
  (select count(*) from public.sync_changes
   where entity_id in (
     '74000000-0000-0000-0000-000000000007',
     '75000000-0000-0000-0000-000000000007',
     '76000000-0000-0000-0000-000000000007'
   )),
  3::bigint,
  'one bundle transaction emits exactly client, job, and invoice changes'
);

set local role authenticated;
create temporary table delete_response (response jsonb not null) on commit drop;
insert into delete_response (response)
select public.apply_entity_mutation(
  '77000000-0000-0000-0000-000000000007',
  'client',
  'delete',
  '72000000-0000-0000-0000-000000000007',
  1,
  '{}'
);
select is(
  (select response ->> 'mutation_id' from delete_response),
  '77000000-0000-0000-0000-000000000007',
  'delete response is also mutation-bound'
);
select is(
  (select (response ->> 'deleted_at')::timestamptz from delete_response),
  (select (response #>> '{sync_position,updated_at}')::timestamptz from delete_response),
  'a new delete receipt timestamp matches its immutable tombstone feed position'
);
reset role;
select ok(
  (select deleted and payload is null
   from public.sync_changes
   where entity_id = '72000000-0000-0000-0000-000000000007'
   order by change_id desc limit 1),
  'delete emits a null tombstone instead of losing the record identity'
);
set local role authenticated;
select is(
  public.apply_entity_mutation(
    '77100000-0000-0000-0000-000000000007',
    'client',
    'update',
    '72000000-0000-0000-0000-000000000007',
    1,
    '{"name":"Missing cloud row"}'
  ) ->> 'status',
  'conflict',
  'an update racing a cloud delete returns structured null conflict'
);
select is(
  public.apply_entity_mutation(
    '77100000-0000-0000-0000-000000000007',
    'client',
    'update',
    '72000000-0000-0000-0000-000000000007',
    1,
    '{"changed":true}'
  ) -> 'cloud_payload',
  'null'::jsonb,
  'the missing-row conflict replays a genuine null cloud payload'
);
reset role;

-- Flood user B before user A pulls. A correct implementation filters by owner and cursor
-- before applying its page limit.
insert into public.clients (id, user_id, name)
select (
  md5('sync-owner-b-' || value::text)
)::uuid,
  '80000000-0000-0000-0000-000000000008',
  'Other owner ' || value
from generate_series(1, 550) as value;

insert into public.clients (id, user_id, name)
select (
  md5('sync-owner-a-' || value::text)
)::uuid,
  '70000000-0000-0000-0000-000000000007',
  'Paged owner ' || value
from generate_series(1, 510) as value;

-- Prove that change_id, rather than entity UUID, disambiguates equal timestamps.
update public.sync_changes
set updated_at = '2026-08-03T12:00:00.000Z'
where user_id = '70000000-0000-0000-0000-000000000007';

set local role authenticated;
create temporary table invoice_only_page (response jsonb not null) on commit drop;
insert into invoice_only_page (response)
select public.pull_sync_changes(
  '2026-08-03T12:00:00.000Z'::timestamptz,
  ((select response #>> '{sync_positions,invoice,change_id}' from bundle_response))::bigint - 1,
  1
);
select is(
  concat_ws(
    '|',
    (select response #>> '{changes,0,entity}' from invoice_only_page),
    (select response #>> '{changes,0,payload,clients,name}' from invoice_only_page),
    (select response #>> '{changes,0,payload,jobs,title}' from invoice_only_page)
  ),
  'invoice|Bundle client|Bundle job',
  'an invoice-only cursor page carries self-contained immutable relationship history'
);

create temporary table first_page (response jsonb not null) on commit drop;
insert into first_page (response)
select public.pull_sync_changes(null, null, 500);
select is(
  jsonb_array_length((select response -> 'changes' from first_page)),
  500,
  'the first owner-filtered page reaches the requested 500-row bound'
);
select is(
  (select response ->> 'has_more' from first_page),
  'true',
  'the server reports more than 500 owner changes'
);
select is(
  (select count(*) from jsonb_array_elements((select response -> 'changes' from first_page)) as item
   where item ->> 'owner_id' <> '70000000-0000-0000-0000-000000000007'),
  0::bigint,
  'the page never leaks another owners feed entries'
);

create temporary table second_page (response jsonb not null) on commit drop;
insert into second_page (response)
select public.pull_sync_changes(
  ((select response #>> '{cursor,updated_at}' from first_page))::timestamptz,
  ((select response #>> '{cursor,change_id}' from first_page))::bigint,
  500
);
select is(
  (
    select jsonb_array_length(first.response -> 'changes') +
           jsonb_array_length(second.response -> 'changes')
    from first_page as first cross join second_page as second
  ),
  515,
  'two cursor pages contain every owner change exactly once even when timestamps tie'
);
select is(
  (select count(*) from jsonb_array_elements((select response -> 'changes' from first_page)) as first_item
   join jsonb_array_elements((select response -> 'changes' from second_page)) as second_item
     on first_item ->> 'change_id' = second_item ->> 'change_id'),
  0::bigint,
  'equal-timestamp pages do not duplicate a change ID'
);
select is(
  (select response ->> 'has_more' from second_page),
  'false',
  'the terminal page is explicitly complete'
);

select throws_ok(
  $$ select * from public.sync_changes $$,
  '42501',
  null,
  'authenticated clients cannot read the internal feed table directly'
);
select throws_ok(
  $$ insert into public.sync_changes
       (user_id, entity, entity_id, version, payload, deleted)
     values (auth.uid(), 'client', gen_random_uuid(), 1, '{}', false) $$,
  '42501',
  null,
  'authenticated clients cannot forge feed entries'
);

-- Advance one member and submit the stale compound bundle. The result must be a
-- receipt-backed structured conflict, not a serialization exception.
select is(
  public.apply_entity_mutation(
    '78000000-0000-0000-0000-000000000007',
    'client',
    'update',
    '74000000-0000-0000-0000-000000000007',
    1,
    '{"name":"Cloud advanced"}'
  ) ->> 'status',
  'applied',
  'the cloud client advances independently before the stale bundle'
);

create temporary table stale_bundle (response jsonb not null) on commit drop;
insert into stale_bundle (response)
select public.save_invoice_bundle(
  '79000000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":1,"name":"Stale client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","title":"Bundle job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is((select response ->> 'status' from stale_bundle), 'conflict', 'stale bundle returns structured conflict');
select is((select response ->> 'mutation_id' from stale_bundle), '79000000-0000-0000-0000-000000000007', 'bundle conflict binds its mutation ID');
select is((select response #>> '{cloud_versions,client}' from stale_bundle), '2', 'bundle conflict carries the client cloud version');
select is((select response #>> '{cloud_payload,invoice,id}' from stale_bundle), '76000000-0000-0000-0000-000000000007', 'bundle conflict carries the canonical related invoice');
select is(
  public.save_invoice_bundle(
    '79000000-0000-0000-0000-000000000007',
    '{"client":{"id":"74000000-0000-0000-0000-000000000007"},"job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007"},"invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007"}}'
  )::text,
  (select response::text from stale_bundle),
  'the structured bundle conflict is replayed from its durable receipt'
);

reset role;
delete from public.invoices
where user_id = '70000000-0000-0000-0000-000000000007'
  and id = '76000000-0000-0000-0000-000000000007';
set local role authenticated;
create temporary table missing_invoice_bundle (response jsonb not null) on commit drop;
insert into missing_invoice_bundle (response)
select public.save_invoice_bundle(
  '79100000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":2,"name":"Edited client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","title":"Edited job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is((select response ->> 'status' from missing_invoice_bundle), 'conflict', 'a remotely deleted invoice produces a compound conflict');
select is((select response -> 'cloud_payload' -> 'invoice' from missing_invoice_bundle), 'null'::jsonb, 'the compound conflict preserves the deleted invoice as null');
select is((select response #>> '{cloud_payload,job,id}' from missing_invoice_bundle), '75000000-0000-0000-0000-000000000007', 'the compound deletion conflict preserves the canonical remaining job');
select is((select response #>> '{cloud_versions,invoice}' from missing_invoice_bundle), '0', 'the deleted compound member has a zero cloud version');
select is(
  public.save_invoice_bundle(
    '79100000-0000-0000-0000-000000000007',
    '{"client":{"id":"74000000-0000-0000-0000-000000000007"},"job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007"},"invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007"}}'
  )::text,
  (select response::text from missing_invoice_bundle),
  'the compound deletion conflict replays durably'
);

select is(
  public.save_invoice_bundle(
    '79200000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":2,"name":"Edited client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","title":"Edited job","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":0,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
    }'
  ) ->> 'status',
  'applied',
  'an explicit zero-version invoice recreation applies atomically'
);
select is(
  public.save_invoice_bundle(
    '79300000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":3,"name":"Edited client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":2,"clientId":"74000000-0000-0000-0000-000000000007","title":"Edited job","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":0,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
    }'
  ) ->> 'status',
  'conflict',
  'a concurrent invoice recreation returns a new compound conflict'
);

reset role;
delete from public.invoices where id = '76000000-0000-0000-0000-000000000007';
delete from public.jobs where id = '75000000-0000-0000-0000-000000000007';
set local role authenticated;
create temporary table missing_job_bundle (response jsonb not null) on commit drop;
insert into missing_job_bundle (response)
select public.save_invoice_bundle(
  '79400000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":3,"name":"Edited client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":2,"clientId":"74000000-0000-0000-0000-000000000007","title":"Edited job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is((select response -> 'cloud_payload' -> 'job' from missing_job_bundle), 'null'::jsonb, 'a deleted job remains null in the compound conflict');
select is((select response -> 'cloud_payload' -> 'invoice' from missing_job_bundle), 'null'::jsonb, 'a deleted dependent invoice remains null with its job');

reset role;
delete from public.clients where id = '74000000-0000-0000-0000-000000000007';
set local role authenticated;
select is(
  (
    select change #>> '{payload,clients,name}'
    from jsonb_array_elements(public.pull_sync_changes(null, null, 500) -> 'changes') as entry(change)
    where change ->> 'entity' = 'invoice'
      and change ->> 'entity_id' = '76000000-0000-0000-0000-000000000007'
      and (change ->> 'deleted')::boolean = false
    order by (change ->> 'change_id')::bigint
    limit 1
  ),
  'Bundle client',
  'historical invoice feed events retain durable relationship snapshots after current rows are deleted'
);
select is(
  public.apply_entity_mutation(
    '73700000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{"number":"Ignored replay body"}'
  ) #>> '{cloud,clients,name}',
  'Bundle client',
  'a durable legacy invoice receipt binds after its current relationships are deleted'
);

create temporary table raw_legacy_invoice_replay (response jsonb not null) on commit drop;
insert into raw_legacy_invoice_replay (response)
select public.apply_entity_mutation(
  '73800000-0000-0000-0000-000000000007',
  'invoice',
  'update',
  '76000000-0000-0000-0000-000000000007',
  1,
  '{"number":"Ignored replay body"}'
);
select is(
  concat_ws(
    '|',
    (select response ->> 'repair_from_feed' from raw_legacy_invoice_replay),
    (select response #>> '{sync_position,source}' from raw_legacy_invoice_replay),
    (select response #>> '{sync_position,change_id}' from raw_legacy_invoice_replay)
  ),
  'true|legacy_receipt|0',
  'a raw migration-002 invoice receipt requests safe feed repair instead of grafting later relations'
);

select throws_ok(
  $$ select public.apply_entity_mutation(
    '73820000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{"number":"Malformed partial snapshots"}'
  ) $$,
  '22023',
  null,
  'a partially present invalid invoice relationship snapshot fails closed'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73830000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{"number":"Corrupt raw receipt"}'
  ) $$,
  '22023',
  null,
  'a raw invoice receipt impossible under core constraints fails closed instead of scheduling repair'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73840000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{}'
  ) $$,
  '22023',
  null,
  'a raw invoice receipt with a JSON-null number fails closed'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73850000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{}'
  ) $$,
  '22023',
  null,
  'a raw invoice receipt with JSON-null payment terms fails closed'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73860000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{}'
  ) $$,
  '22023',
  null,
  'a raw invoice receipt missing status fails closed'
);

create temporary table unreconstructable_invoice_repair (response jsonb not null) on commit drop;
insert into unreconstructable_invoice_repair (response)
select public.apply_entity_mutation(
  '73810000-0000-0000-0000-000000000007',
  'invoice',
  'update',
  '76000000-0000-0000-0000-000000000007',
  1,
  '{"number":"Ignored repair replay body"}'
);
select is(
  (select response ->> 'repair_from_feed' from unreconstructable_invoice_repair),
  'true',
  'a valid raw invoice receipt explicitly requests deterministic feed repair when history is insufficient'
);
select is(
  (select response -> 'cloud' from unreconstructable_invoice_repair),
  'null'::jsonb,
  'an unreconstructable raw invoice receipt never fabricates a canonical cloud row'
);
select is(
  concat_ws(
    ':',
    (select response #>> '{sync_position,source}' from unreconstructable_invoice_repair),
    (select response #>> '{sync_position,change_id}' from unreconstructable_invoice_repair)
  ),
  'legacy_receipt:0',
  'the repair response carries its validated immutable legacy receipt position'
);
select is(
  public.apply_entity_mutation(
    '73810000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{"number":"Changed replay body"}'
  )::text,
  (select response::text from unreconstructable_invoice_repair),
  'the explicit feed-repair response is durable and idempotent'
);
reset role;
update public.mutation_receipts
set response = jsonb_set(response, '{sync_position}', '{}'::jsonb)
where user_id = '70000000-0000-0000-0000-000000000007'
  and mutation_id = '73810000-0000-0000-0000-000000000007';
set local role authenticated;
select throws_ok(
  $$ select public.apply_entity_mutation(
    '73810000-0000-0000-0000-000000000007',
    'invoice',
    'update',
    '76000000-0000-0000-0000-000000000007',
    1,
    '{}'
  ) $$,
  '22023',
  null,
  'a stored feed-repair receipt with a malformed position fails closed'
);
select is(
  public.save_invoice_bundle(
    '73900000-0000-0000-0000-000000000007',
    '{"client":{"id":"74000000-0000-0000-0000-000000000007"},"job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007"},"invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007"}}'
  ) ->> 'mutation_id',
  '73900000-0000-0000-0000-000000000007',
  'a durable legacy bundle receipt binds after every current member is deleted'
);
reset role;
select is(
  (
    select concat_ws(
      '|',
      response ->> 'repair_from_feed',
      response #>> '{sync_position,source}',
      response #>> '{sync_position,change_id}'
    )
    from public.mutation_receipts
    where user_id = '70000000-0000-0000-0000-000000000007'
      and mutation_id = '73800000-0000-0000-0000-000000000007'
  ),
  'true|legacy_receipt|0',
  'the safe raw invoice feed-repair receipt is durably upgraded for later replays'
);
set local role authenticated;
create temporary table missing_all_bundle (response jsonb not null) on commit drop;
insert into missing_all_bundle (response)
select public.save_invoice_bundle(
  '79500000-0000-0000-0000-000000000007',
  '{
    "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":3,"name":"Edited client"},
    "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":2,"clientId":"74000000-0000-0000-0000-000000000007","title":"Edited job","tradeType":"General","status":"Invoiced"},
    "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":1,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
  }'
);
select is((select response -> 'cloud_payload' -> 'client' from missing_all_bundle), 'null'::jsonb, 'a deleted client remains null in the compound conflict');
select is((select response #>> '{cloud_versions,client}' from missing_all_bundle), '0', 'an absent compound relationship has an explicit zero version');
select is(
  public.save_invoice_bundle(
    '79500000-0000-0000-0000-000000000007',
    '{"client":{"id":"74000000-0000-0000-0000-000000000007"},"job":{"id":"75000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007"},"invoice":{"id":"76000000-0000-0000-0000-000000000007","clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007"}}'
  )::text,
  (select response::text from missing_all_bundle),
  'an all-deleted compound conflict is idempotent'
);
select is(
  public.save_invoice_bundle(
    '79600000-0000-0000-0000-000000000007',
    '{
      "client":{"id":"74000000-0000-0000-0000-000000000007","baseVersion":0,"name":"Recreated client"},
      "job":{"id":"75000000-0000-0000-0000-000000000007","baseVersion":0,"clientId":"74000000-0000-0000-0000-000000000007","title":"Recreated job","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"76000000-0000-0000-0000-000000000007","baseVersion":0,"clientId":"74000000-0000-0000-0000-000000000007","jobId":"75000000-0000-0000-0000-000000000007","number":"SYNC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Due on receipt","status":"Draft"}
    }'
  ) ->> 'status',
  'applied',
  'explicit zero versions coherently recreate all deleted bundle members'
);
select ok(
  exists (
    select 1 from public.invoices as invoice
    join public.jobs as job
      on job.user_id = invoice.user_id and job.client_id = invoice.client_id and job.id = invoice.job_id
    join public.clients as client
      on client.user_id = job.user_id and client.id = job.client_id
    where invoice.id = '76000000-0000-0000-0000-000000000007'
  ),
  'the explicit compound recreation preserves every ownership relationship'
);

select * from finish();
rollback;
