begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

insert into auth.users (id, email)
values
  ('30000000-0000-0000-0000-000000000003', 'rls-a@example.test'),
  ('40000000-0000-0000-0000-000000000004', 'rls-b@example.test');

insert into public.profiles (id, business_name)
values
  ('30000000-0000-0000-0000-000000000003', 'Business A'),
  ('40000000-0000-0000-0000-000000000004', 'Business B');
insert into public.clients (id, user_id, name)
values
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Client A'),
  ('41000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 'Client B');
insert into public.jobs (id, user_id, client_id, title, trade_type, status)
values
  ('32000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003', 'Job A', 'General', 'Scheduled'),
  ('42000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '41000000-0000-0000-0000-000000000004', 'Job B', 'General', 'Scheduled');
insert into public.invoices (
  id, user_id, client_id, job_id, number, line_items, subtotal_cents,
  tax_basis_points, tax_cents, total_cents, payment_terms, status
)
values
  ('33000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '31000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000003', 'RLS-A', '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}]', 100, 0, 0, 100, 'Net 30', 'Draft'),
  ('43000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '41000000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-000000000004', 'RLS-B', '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}]', 100, 0, 0, 100, 'Net 30', 'Draft');
insert into public.expenses (id, user_id, job_id, vendor, amount_cents, expense_date)
values
  ('34000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000003', 'Vendor A', 100, current_date),
  ('44000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '42000000-0000-0000-0000-000000000004', 'Vendor B', 100, current_date);
insert into public.services (id, user_id, name, unit_price_cents)
values
  ('35000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Service A', 100),
  ('45000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 'Service B', 100);
insert into public.inventory_items (id, user_id, name, unit, unit_price_cents)
values
  ('36000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Inventory A', 'each', 100),
  ('46000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', 'Inventory B', 'each', 100);
insert into public.mutation_receipts (user_id, mutation_id, response)
values
  ('30000000-0000-0000-0000-000000000003', '37000000-0000-0000-0000-000000000003', '{"owner":"a"}'),
  ('40000000-0000-0000-0000-000000000004', '47000000-0000-0000-0000-000000000004', '{"owner":"b"}');
insert into public.ai_rate_limits (user_id, window_started_at, request_count)
values
  ('30000000-0000-0000-0000-000000000003', date_trunc('hour', now()), 1),
  ('40000000-0000-0000-0000-000000000004', date_trunc('hour', now()), 1);

select set_config(
  'request.jwt.claims',
  '{"sub":"30000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
set local role authenticated;

select results_eq($$ select id from public.profiles $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'profiles are owner readable');
select results_eq($$ select user_id from public.clients $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'clients are owner readable');
select results_eq($$ select user_id from public.jobs $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'jobs are owner readable');
select results_eq($$ select user_id from public.invoices $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'invoices are owner readable');
select results_eq($$ select user_id from public.expenses $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'expenses are owner readable');
select results_eq($$ select user_id from public.services $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'services are owner readable');
select results_eq($$ select user_id from public.inventory_items $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'inventory is owner readable');

select throws_ok($$ insert into public.profiles (id) values ('30000000-0000-0000-0000-000000000003') $$, '42501', null, 'profiles reject direct inserts');
select throws_ok($$ update public.profiles set business_name = 'forged' where id = auth.uid() $$, '42501', null, 'profiles reject direct updates');
select throws_ok($$ delete from public.profiles where id = auth.uid() $$, '42501', null, 'profiles reject direct deletes');

select throws_ok($$ insert into public.clients (user_id, name) values (auth.uid(), 'forged') $$, '42501', null, 'clients reject direct inserts');
select throws_ok($$ update public.clients set name = 'forged' where user_id = auth.uid() $$, '42501', null, 'clients reject direct updates');
select throws_ok($$ delete from public.clients where user_id = auth.uid() $$, '42501', null, 'clients reject direct deletes');

select throws_ok($$ insert into public.jobs (user_id, client_id, title, trade_type, status) values (auth.uid(), '31000000-0000-0000-0000-000000000003', 'forged', 'General', 'Scheduled') $$, '42501', null, 'jobs reject direct inserts');
select throws_ok($$ update public.jobs set title = 'forged' where user_id = auth.uid() $$, '42501', null, 'jobs reject direct updates');
select throws_ok($$ delete from public.jobs where user_id = auth.uid() $$, '42501', null, 'jobs reject direct deletes');

select throws_ok($$ insert into public.invoices (user_id, client_id, number, line_items, subtotal_cents, tax_cents, total_cents, payment_terms) values (auth.uid(), '31000000-0000-0000-0000-000000000003', 'FORGED', '[{"description":"x","type":"labor","quantity":1000,"unitPriceCents":1}]', 1, 0, 1, 'Net 30') $$, '42501', null, 'invoices reject direct inserts');
select throws_ok($$ update public.invoices set total_cents = 999 where user_id = auth.uid() $$, '42501', null, 'invoices reject direct updates');
select throws_ok($$ delete from public.invoices where user_id = auth.uid() $$, '42501', null, 'invoices reject direct deletes');

select throws_ok($$ insert into public.expenses (user_id, vendor, amount_cents, expense_date) values (auth.uid(), 'forged', 1, current_date) $$, '42501', null, 'expenses reject direct inserts');
select throws_ok($$ update public.expenses set amount_cents = 999 where user_id = auth.uid() $$, '42501', null, 'expenses reject direct updates');
select throws_ok($$ delete from public.expenses where user_id = auth.uid() $$, '42501', null, 'expenses reject direct deletes');

select throws_ok($$ insert into public.services (user_id, name) values (auth.uid(), 'forged') $$, '42501', null, 'services reject direct inserts');
select throws_ok($$ update public.services set unit_price_cents = 999 where user_id = auth.uid() $$, '42501', null, 'services reject direct updates');
select throws_ok($$ delete from public.services where user_id = auth.uid() $$, '42501', null, 'services reject direct deletes');

select throws_ok($$ insert into public.inventory_items (user_id, name, unit) values (auth.uid(), 'forged', 'each') $$, '42501', null, 'inventory rejects direct inserts');
select throws_ok($$ update public.inventory_items set quantity_thousandths = 999 where user_id = auth.uid() $$, '42501', null, 'inventory rejects direct updates');
select throws_ok($$ delete from public.inventory_items where user_id = auth.uid() $$, '42501', null, 'inventory rejects direct deletes');

select throws_ok($$ select * from public.mutation_receipts $$, '42501', null, 'mutation receipts reject direct selects');
select throws_ok($$ insert into public.mutation_receipts (user_id, mutation_id, response) values (auth.uid(), gen_random_uuid(), '{}') $$, '42501', null, 'mutation receipts reject direct inserts');
select throws_ok($$ update public.mutation_receipts set response = '{"forged":true}' $$, '42501', null, 'mutation receipts reject direct updates');
select throws_ok($$ delete from public.mutation_receipts $$, '42501', null, 'mutation receipts reject direct deletes');

select throws_ok($$ select * from public.ai_rate_limits $$, '42501', null, 'AI rate limits reject direct selects');
select throws_ok($$ insert into public.ai_rate_limits (user_id, window_started_at, request_count) values (auth.uid(), now(), 0) $$, '42501', null, 'AI rate limits reject direct inserts');
select throws_ok($$ update public.ai_rate_limits set request_count = 0 $$, '42501', null, 'AI rate limits reject direct updates');
select throws_ok($$ delete from public.ai_rate_limits $$, '42501', null, 'AI rate limits reject direct deletes');

select is(
  public.apply_entity_mutation(
    '38000000-0000-0000-0000-000000000003', 'client', 'update',
    '31000000-0000-0000-0000-000000000003', 1, '{"name":"Owned RPC update"}'
  ) ->> 'status',
  'applied',
  'authenticated RPC can update an owned row'
);
select throws_ok(
  $$ select public.apply_entity_mutation(
       '39000000-0000-0000-0000-000000000003', 'client', 'update',
       '41000000-0000-0000-0000-000000000004', 1, '{"name":"Cross owner"}'
     ) $$,
  '22023',
  null,
  'authenticated RPC cannot update another owners row'
);
select is(
  public.save_invoice_bundle(
    '3a000000-0000-0000-0000-000000000003',
    '{
      "client":{"id":"3b000000-0000-0000-0000-000000000003","name":"RPC Client"},
      "job":{"id":"3c000000-0000-0000-0000-000000000003","clientId":"3b000000-0000-0000-0000-000000000003","title":"RPC Job","tradeType":"General","status":"Invoiced"},
      "invoice":{"id":"3d000000-0000-0000-0000-000000000003","clientId":"3b000000-0000-0000-0000-000000000003","jobId":"3c000000-0000-0000-0000-000000000003","number":"RPC-001","lineItems":[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":100}],"subtotalCents":100,"taxBasisPoints":0,"taxCents":0,"totalCents":100,"paymentTerms":"Net 30","status":"Draft"}
    }'
  ) ->> 'status',
  'applied',
  'authenticated bundle RPC can create owned rows'
);
select results_eq(
  $$ select id from public.invoices where id = '3d000000-0000-0000-0000-000000000003' $$,
  $$ values ('3d000000-0000-0000-0000-000000000003'::uuid) $$,
  'RPC-created invoice is owner readable'
);

select throws_ok($$ select * from public.subscription_entitlements $$, '42501', null, 'entitlements reject direct owner reads');
select throws_ok($$ select * from public.revenuecat_event_receipts $$, '42501', null, 'RevenueCat receipts reject direct owner reads');
select throws_ok($$ select * from public.feature_admissions $$, '42501', null, 'feature admissions reject direct owner reads');
select throws_ok(
  $$ insert into public.subscription_entitlements (
       user_id, entitlement, product_id, environment, status, provider_active,
       expires_at, provider_event_at, event_rank
     ) values (
       auth.uid(), 'pro', 'fieldcraft_pro_monthly', 'SANDBOX', 'active', true,
       now() + interval '1 month', now(), 1
     ) $$,
  '42501', null, 'authenticated users cannot forge entitlements'
);
select is(public.get_my_entitlement() ->> 'state', 'free', 'owner entitlement RPC defaults to Free');
select is(
  public.reserve_feature_admission(
    '3e000000-0000-4000-8000-000000000003', 'export-account'
  ) ->> 'allowed',
  'true',
  'downgrade-safe export admission remains allowed'
);
select ok(
  has_function_privilege('authenticated', 'public.get_my_entitlement()', 'execute'),
  'authenticated may execute get_my_entitlement'
);
select ok(
  has_function_privilege('authenticated', 'public.reserve_feature_admission(uuid,text)', 'execute'),
  'authenticated may execute feature admission'
);
select ok(
  not has_function_privilege('authenticated', 'public.apply_revenuecat_event(text,uuid,text,text,text,boolean,timestamptz,timestamptz,text)', 'execute'),
  'authenticated cannot apply RevenueCat events'
);
select ok(
  has_function_privilege('service_role', 'public.apply_revenuecat_event(text,uuid,text,text,text,boolean,timestamptz,timestamptz,text)', 'execute'),
  'service role alone may apply RevenueCat events'
);

select * from finish();
rollback;
