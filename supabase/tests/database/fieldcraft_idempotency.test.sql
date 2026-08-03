begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, email)
values
  ('50000000-0000-0000-0000-000000000005', 'idempotency-a@example.test'),
  ('60000000-0000-0000-0000-000000000006', 'idempotency-b@example.test');

select set_config(
  'request.jwt.claims',
  '{"sub":"50000000-0000-0000-0000-000000000005","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $$ select public.save_invoice_bundle(
       '51000000-0000-0000-0000-000000000005',
       jsonb_build_object(
         'client', jsonb_build_object('id', '52000000-0000-0000-0000-000000000005', 'name', 'Rollback Client'),
         'job', jsonb_build_object('id', '53000000-0000-0000-0000-000000000005', 'clientId', '52000000-0000-0000-0000-000000000005', 'title', 'Rollback Job', 'tradeType', 'General', 'status', 'Invoiced'),
         'invoice', jsonb_build_object(
           'id', '54000000-0000-0000-0000-000000000005',
           'clientId', '52000000-0000-0000-0000-000000000005',
           'jobId', '53000000-0000-0000-0000-000000000005',
           'number', 'ROLLBACK-001',
           'lineItems', (select jsonb_agg(jsonb_build_object('description', 'Item', 'type', 'labor', 'quantity', 1000, 'unitPriceCents', 100)) from generate_series(1, 101)),
           'subtotalCents', 10100, 'taxBasisPoints', 0, 'taxCents', 0, 'totalCents', 10100,
           'paymentTerms', 'Net 30', 'status', 'Draft'
         )
       )
     ) $$,
  '22023',
  null,
  'a malformed invoice bundle is rejected'
);
select is((select count(*) from public.clients), 0::bigint, 'malformed bundle rolls back its client');
select is((select count(*) from public.jobs), 0::bigint, 'malformed bundle rolls back its job');
select is((select count(*) from public.invoices), 0::bigint, 'malformed bundle rolls back its invoice');
select is((select count(*) from public.mutation_receipts), 0::bigint, 'malformed bundle does not store a receipt');

create temporary table first_response (response jsonb not null) on commit drop;
insert into first_response (response)
select public.save_invoice_bundle(
  '55000000-0000-0000-0000-000000000005',
  '{
    "client":{"id":"52000000-0000-0000-0000-000000000005","name":"Replay Client"},
    "job":{"id":"53000000-0000-0000-0000-000000000005","clientId":"52000000-0000-0000-0000-000000000005","title":"Replay Job","tradeType":"Plumbing","status":"Invoiced"},
    "invoice":{"id":"54000000-0000-0000-0000-000000000005","clientId":"52000000-0000-0000-0000-000000000005","jobId":"53000000-0000-0000-0000-000000000005","number":"INV-REPLAY-A","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":2500}],"subtotalCents":2500,"taxBasisPoints":1000,"taxCents":250,"totalCents":2750,"paymentTerms":"Net 30","status":"Draft"}
  }'::jsonb
);

select is((select response ->> 'status' from first_response), 'applied', 'first bundle application returns applied');
select is(
  public.save_invoice_bundle(
    '55000000-0000-0000-0000-000000000005',
    '{"client":{"id":"ffffffff-ffff-ffff-ffff-ffffffffffff","name":"Must not apply"}}'::jsonb
  ),
  (select response from first_response),
  'replay returns the original response before validating a changed payload'
);
select is((select count(*) from public.clients), 1::bigint, 'replay creates no duplicate client');
select is((select count(*) from public.jobs), 1::bigint, 'replay creates no duplicate job');
select is((select count(*) from public.invoices), 1::bigint, 'replay creates no duplicate invoice');

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"60000000-0000-0000-0000-000000000006","role":"authenticated"}',
  true
);
set local role authenticated;

select isnt(
  public.save_invoice_bundle(
    '55000000-0000-0000-0000-000000000005',
    '{
      "client":{"id":"62000000-0000-0000-0000-000000000006","name":"User B Client"},
      "job":{"id":"63000000-0000-0000-0000-000000000006","clientId":"62000000-0000-0000-0000-000000000006","title":"User B Job","tradeType":"Electrical","status":"Invoiced"},
      "invoice":{"id":"64000000-0000-0000-0000-000000000006","clientId":"62000000-0000-0000-0000-000000000006","jobId":"63000000-0000-0000-0000-000000000006","number":"INV-REPLAY-B","lineItems":[{"description":"Material","type":"material","quantity":1000,"unitPriceCents":500}],"subtotalCents":500,"taxBasisPoints":0,"taxCents":0,"totalCents":500,"paymentTerms":"Due on receipt","status":"Draft"}
    }'::jsonb
  ),
  (select response from first_response),
  'user B cannot receive user As mutation receipt'
);
select is((select count(*) from public.mutation_receipts), 1::bigint, 'RLS exposes only user Bs same-ID receipt');

select is(
  public.apply_entity_mutation(
    '65000000-0000-0000-0000-000000000006',
    'client',
    'update',
    '62000000-0000-0000-0000-000000000006',
    1,
    '{"name":"Fresh cloud name"}'::jsonb
  ) ->> 'status',
  'applied',
  'matching base version updates the entity'
);

create temporary table conflict_response (response jsonb not null) on commit drop;
insert into conflict_response (response)
select public.apply_entity_mutation(
  '66000000-0000-0000-0000-000000000006',
  'client',
  'update',
  '62000000-0000-0000-0000-000000000006',
  1,
  '{"name":"Stale local name"}'::jsonb
);

select is((select response ->> 'status' from conflict_response), 'conflict', 'stale base version returns conflict');
select is((select response ->> 'base_version' from conflict_response), '1', 'conflict returns the submitted base version');
select is((select response ->> 'cloud_version' from conflict_response), '2', 'conflict returns the current cloud version');
select is((select name from public.clients where id = '62000000-0000-0000-0000-000000000006'), 'Fresh cloud name', 'stale mutation preserves cloud state');

select * from finish();
rollback;
