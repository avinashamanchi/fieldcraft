begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

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

set local role authenticated;
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
select is(
  public.apply_entity_mutation(
    '77000000-0000-0000-0000-000000000007',
    'client',
    'delete',
    '72000000-0000-0000-0000-000000000007',
    1,
    '{}'
  ) ->> 'mutation_id',
  '77000000-0000-0000-0000-000000000007',
  'delete response is also mutation-bound'
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
  public.save_invoice_bundle('79000000-0000-0000-0000-000000000007', '{"changed":true}')::text,
  (select response::text from stale_bundle),
  'the structured bundle conflict is replayed from its durable receipt'
);

select * from finish();
rollback;
