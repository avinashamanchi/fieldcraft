begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

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

select results_eq(
  $$ select id from public.profiles order by id $$,
  $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$,
  'profiles select exposes only the active user'
);
select results_eq(
  $$ update public.profiles set business_name = 'Updated A' returning id $$,
  $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$,
  'profiles update mutates only the active user'
);
select throws_ok(
  $$ insert into public.profiles (id, business_name) values ('40000000-0000-0000-0000-000000000004', 'Imposter') $$,
  '42501', null, 'profiles insert rejects another owner'
);

select results_eq($$ select user_id from public.clients $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'clients select is owner scoped');
select results_eq($$ update public.clients set notes = 'mine' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'clients update is owner scoped');
select is_empty($$ delete from public.clients where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'clients delete cannot target another owner');

select results_eq($$ select user_id from public.jobs $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'jobs select is owner scoped');
select results_eq($$ update public.jobs set notes = 'mine' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'jobs update is owner scoped');
select is_empty($$ delete from public.jobs where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'jobs delete cannot target another owner');

select results_eq($$ select user_id from public.invoices $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'invoices select is owner scoped');
select results_eq($$ update public.invoices set notes = 'mine' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'invoices update is owner scoped');
select is_empty($$ delete from public.invoices where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'invoices delete cannot target another owner');

select results_eq($$ select user_id from public.expenses $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'expenses select is owner scoped');
select results_eq($$ update public.expenses set notes = 'mine' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'expenses update is owner scoped');
select is_empty($$ delete from public.expenses where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'expenses delete cannot target another owner');

select results_eq($$ select user_id from public.services $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'services select is owner scoped');
select results_eq($$ update public.services set description = 'mine' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'services update is owner scoped');
select is_empty($$ delete from public.services where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'services delete cannot target another owner');

select results_eq($$ select user_id from public.inventory_items $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'inventory select is owner scoped');
select results_eq($$ update public.inventory_items set unit = 'box' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'inventory update is owner scoped');
select is_empty($$ delete from public.inventory_items where user_id = '40000000-0000-0000-0000-000000000004' returning id $$, 'inventory delete cannot target another owner');

select results_eq($$ select user_id from public.mutation_receipts $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'mutation receipts select is owner scoped');
select results_eq($$ update public.mutation_receipts set response = '{"updated":true}' returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'mutation receipts update is owner scoped');
select is_empty($$ delete from public.mutation_receipts where user_id = '40000000-0000-0000-0000-000000000004' returning mutation_id $$, 'mutation receipts delete cannot target another owner');

select results_eq($$ select user_id from public.ai_rate_limits $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'AI rate limits select is owner scoped');
select results_eq($$ update public.ai_rate_limits set request_count = request_count + 1 returning user_id $$, $$ values ('30000000-0000-0000-0000-000000000003'::uuid) $$, 'AI rate limits update is owner scoped');
select is_empty($$ delete from public.ai_rate_limits where user_id = '40000000-0000-0000-0000-000000000004' returning user_id $$, 'AI rate limits delete cannot target another owner');

select * from finish();
rollback;
