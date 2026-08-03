begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'constraints-a@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'constraints-b@example.test');

insert into public.clients (id, user_id, name)
values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Client A'),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Client B');

insert into public.jobs (id, user_id, client_id, title, trade_type, status)
values
  (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    'Job A',
    'Plumbing',
    'Scheduled'
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '22000000-0000-0000-0000-000000000002',
    'Job B',
    'Electrical',
    'In Progress'
  );

select throws_ok(
  $$ insert into public.expenses (user_id, vendor, amount_cents, expense_date)
     values ('10000000-0000-0000-0000-000000000001', 'Vendor', -1, current_date) $$,
  '23514',
  null,
  'negative expense amount is rejected'
);

select throws_ok(
  $$ insert into public.services (user_id, name, unit_price_cents)
     values ('10000000-0000-0000-0000-000000000001', 'Impossible price', 100000001) $$,
  '23514',
  null,
  'money above the reviewed maximum is rejected'
);

select throws_ok(
  $$ insert into public.jobs (
       user_id, client_id, title, trade_type, status, labor_hours_thousandths
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'Too many hours',
       'General',
       'Scheduled',
       10001
     ) $$,
  '23514',
  null,
  'job hours above the Task 2 thousandths limit are rejected'
);

select throws_ok(
  $$ insert into public.services (
       user_id, name, estimated_hours_thousandths, unit_price_cents
     ) values (
       '10000000-0000-0000-0000-000000000001',
       'Too many estimated hours',
       10001,
       100
     ) $$,
  '23514',
  null,
  'service hours above the Task 2 thousandths limit are rejected'
);

select throws_ok(
  $$ insert into public.inventory_items (
       user_id, name, quantity_thousandths, unit, unit_price_cents
     ) values (
       '10000000-0000-0000-0000-000000000001',
       'Too much inventory',
       10001,
       'each',
       100
     ) $$,
  '23514',
  null,
  'inventory quantity above the Task 2 thousandths limit is rejected'
);

select throws_ok(
  $$ insert into public.inventory_items (
       user_id, name, unit, min_stock_thousandths, unit_price_cents
     ) values (
       '10000000-0000-0000-0000-000000000001',
       'Too much minimum stock',
       'each',
       10001,
       100
     ) $$,
  '23514',
  null,
  'inventory minimum stock above the Task 2 thousandths limit is rejected'
);

select throws_ok(
  $$ insert into public.jobs (user_id, client_id, title, trade_type, status)
     values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'Bad status',
       'Plumbing',
       'Quoted'
     ) $$,
  '23514',
  null,
  'job status outside the Task 2 contract is rejected'
);

select throws_ok(
  $$ insert into public.jobs (user_id, client_id, title, trade_type, status)
     values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'Bad trade',
       'Welding',
       'Scheduled'
     ) $$,
  '23514',
  null,
  'trade type outside the Task 2 contract is rejected'
);

select throws_ok(
  $$ insert into public.expenses (user_id, vendor, amount_cents, category, expense_date)
     values (
       '10000000-0000-0000-0000-000000000001',
       'Vendor',
       100,
       'Meals',
       current_date
     ) $$,
  '23514',
  null,
  'expense category outside the reviewed contract is rejected'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, job_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       '12000000-0000-0000-0000-000000000001',
       'INV-101',
       (select jsonb_agg(jsonb_build_object(
         'description', 'Item', 'type', 'labor', 'quantity', 1000, 'unitPriceCents', 100
       )) from generate_series(1, 101)),
       10100, 0, 0, 10100, 'Net 30', 'Draft'
     ) $$,
  '23514',
  null,
  'an invoice with 101 line items is rejected'
);

insert into public.invoices (
  user_id, client_id, job_id, number, line_items, subtotal_cents,
  tax_basis_points, tax_cents, total_cents, payment_terms, status
)
values (
  '10000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001',
  'INV-001',
  '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
  1000, 0, 0, 1000, 'Due on receipt', 'Draft'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'INV-001',
       '[{"description":"Material","type":"material","quantity":1000,"unitPriceCents":500}]',
       500, 0, 0, 500, 'Net 14', 'Draft'
     ) $$,
  '23505',
  null,
  'invoice numbers are unique per user'
);

select lives_ok(
  $$ insert into public.invoices (
       user_id, client_id, job_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '20000000-0000-0000-0000-000000000002',
       '22000000-0000-0000-0000-000000000002',
       '23000000-0000-0000-0000-000000000002',
       'INV-001',
       '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
       1000, 0, 0, 1000, 'Due on receipt', 'Draft'
     ) $$,
  'different users may use the same invoice number'
);

select throws_ok(
  $$ insert into public.jobs (user_id, client_id, title, trade_type, status)
     values (
       '10000000-0000-0000-0000-000000000001',
       '22000000-0000-0000-0000-000000000002',
       'Cross-owner job',
       'General',
       'Scheduled'
     ) $$,
  '23503',
  null,
  'a job cannot reference another users client'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '22000000-0000-0000-0000-000000000002',
       'INV-CROSS-CLIENT',
       '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
       1000, 0, 0, 1000, 'Net 30', 'Draft'
     ) $$,
  '23503',
  null,
  'an invoice cannot reference another users client'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, job_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       '23000000-0000-0000-0000-000000000002',
       'INV-CROSS-JOB',
       '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
       1000, 0, 0, 1000, 'Net 30', 'Draft'
     ) $$,
  '23503',
  null,
  'an invoice cannot reference another users job'
);

select throws_ok(
  $$ insert into public.expenses (user_id, job_id, vendor, amount_cents, expense_date)
     values (
       '10000000-0000-0000-0000-000000000001',
       '23000000-0000-0000-0000-000000000002',
       'Cross-owner vendor',
       100,
       current_date
     ) $$,
  '23503',
  null,
  'an expense cannot reference another users job'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'INV-BAD-TERMS',
       '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
       1000, 0, 0, 1000, 'Due in 60', 'Draft'
     ) $$,
  '23514',
  null,
  'payment terms outside the Task 2 contract are rejected'
);

select throws_ok(
  $$ insert into public.invoices (
       user_id, client_id, number, line_items, subtotal_cents,
       tax_basis_points, tax_cents, total_cents, payment_terms, status
     ) values (
       '10000000-0000-0000-0000-000000000001',
       '11000000-0000-0000-0000-000000000001',
       'INV-BAD-STATUS',
       '[{"description":"Labor","type":"labor","quantity":1000,"unitPriceCents":1000}]',
       1000, 0, 0, 1000, 'Net 30', 'Overdue'
     ) $$,
  '23514',
  null,
  'invoice status outside the reviewed contract is rejected'
);

select * from finish();
rollback;
