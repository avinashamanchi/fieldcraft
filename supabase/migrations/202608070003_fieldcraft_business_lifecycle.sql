do $$
begin
  if to_regprocedure('public.reserve_feature_admission(uuid,text)') is null then
    raise exception 'migration 202608070002 must run before business lifecycle'
      using errcode = '55000';
  end if;
end
$$;

-- Replace the legacy four-state document markers without losing historical
-- rows. `Overdue` remains derived at display time and is never persisted.
drop trigger if exists invoices_mark_issued on public.invoices;
drop function if exists public.fieldcraft_mark_invoice_issued();
drop index if exists public.invoices_user_issued_idx;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in (
  'Scheduled', 'In Progress', 'Completed', 'Invoiced',
  'Partially Paid', 'Paid', 'Cancelled'
));

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices disable trigger invoices_bump_version;
do $$
declare
  v_user_id uuid;
begin
  for v_user_id in select distinct invoice.user_id from public.invoices as invoice loop
    perform public.fieldcraft_lock_sync_owner(v_user_id, null);
  end loop;
end
$$;
update public.invoices set status = 'Issued' where status = 'Sent';
alter table public.invoices add constraint invoices_status_check check (status in (
  'Draft', 'Issued', 'Viewed', 'Partially Paid', 'Paid', 'Void'
));
alter table public.invoices
  add column issued_at timestamptz,
  add column due_at timestamptz,
  add column currency text not null default 'USD' check (currency = 'USD'),
  add column paid_cents bigint not null default 0
    check (paid_cents between 0 and 100000000),
  add column balance_cents bigint not null default 0
    check (balance_cents between 0 and 100000000);

update public.invoices
set issued_at = sent_at,
    paid_cents = case when status = 'Paid' then total_cents else 0 end,
    balance_cents = case when status = 'Paid' then 0 else total_cents end;
alter table public.invoices enable trigger invoices_bump_version;

alter table public.invoices add constraint invoices_payment_projection_check check (
  paid_cents + balance_cents = total_cents
  and (status <> 'Paid' or balance_cents = 0)
  and (status not in ('Issued', 'Viewed', 'Partially Paid', 'Paid') or issued_at is not null)
  and (issued_at is null or due_at is null or due_at >= issued_at)
);

create function public.fieldcraft_mark_invoice_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.paid_cents = 0 and new.balance_cents = 0 then
    new.balance_cents := new.total_cents;
  end if;
  if new.status in ('Issued', 'Viewed', 'Partially Paid', 'Paid') then
    new.issued_at := coalesce(new.issued_at, new.sent_at, statement_timestamp());
    new.sent_at := coalesce(new.sent_at, new.issued_at);
  end if;
  return new;
end
$$;

revoke execute on function public.fieldcraft_mark_invoice_issued()
  from public, anon, authenticated, service_role;
create trigger invoices_mark_issued
before insert or update of status on public.invoices
for each row execute function public.fieldcraft_mark_invoice_issued();
create index invoices_user_issued_idx
  on public.invoices (user_id, coalesce(issued_at, sent_at, created_at))
  where status in ('Issued', 'Viewed', 'Partially Paid', 'Paid');

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  converted_job_id uuid,
  number text check (number is null or char_length(number) between 1 and 64),
  revision integer not null default 1 check (revision between 1 and 1000000),
  status text not null default 'Draft' check (status in (
    'Draft', 'Issued', 'Accepted', 'Declined', 'Expired', 'Converted', 'Void'
  )),
  title text not null check (char_length(title) between 1 and 200),
  scope text not null check (char_length(scope) between 1 and 4000),
  line_items jsonb not null check (public.is_valid_invoice_line_items(line_items)),
  subtotal_cents bigint not null check (subtotal_cents between 0 and 100000000),
  tax_basis_points integer not null default 0 check (tax_basis_points between 0 and 10000),
  tax_cents bigint not null check (tax_cents between 0 and 100000000),
  total_cents bigint not null check (total_cents between 0 and 100000000),
  currency text not null default 'USD' check (currency = 'USD'),
  expires_at timestamptz not null,
  issued_at timestamptz,
  accepted_at timestamptz,
  acceptance_recorded_by uuid,
  issued_snapshot jsonb,
  notes text check (notes is null or char_length(notes) <= 4000),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint estimates_user_id_id_key unique (user_id, id),
  constraint estimates_user_number_key unique (user_id, number),
  constraint estimates_owned_client_fkey foreign key (user_id, client_id)
    references public.clients(user_id, id) on delete restrict,
  constraint estimates_owned_job_fkey foreign key (user_id, converted_job_id)
    references public.jobs(user_id, id) on delete restrict,
  constraint estimates_acceptance_actor_fkey foreign key (acceptance_recorded_by)
    references auth.users(id) on delete restrict,
  check (
    (status = 'Draft' and issued_at is null and issued_snapshot is null)
    or (
      status <> 'Draft' and issued_at is not null and issued_snapshot is not null
      and number is not null
    )
  ),
  check (
    (status in ('Accepted', 'Converted') and accepted_at is not null
      and acceptance_recorded_by = user_id)
    or (status not in ('Accepted', 'Converted') and accepted_at is null
      and acceptance_recorded_by is null)
  ),
  check ((status = 'Converted') = (converted_job_id is not null))
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 100000000),
  currency text not null check (currency = 'USD'),
  method text not null check (method in (
    'Stripe', 'Cash', 'Check', 'Bank Transfer', 'Other'
  )),
  status text not null check (status in (
    'Pending', 'Succeeded', 'Failed', 'Partially Refunded', 'Refunded', 'Disputed'
  )),
  refunded_cents bigint not null default 0
    check (refunded_cents between 0 and 100000000),
  manual boolean not null,
  note text check (note is null or char_length(note) <= 1000),
  provider_payment_intent_id text check (
    provider_payment_intent_id is null or char_length(provider_payment_intent_id) between 1 and 255
  ),
  provider_charge_id text check (
    provider_charge_id is null or char_length(provider_charge_id) between 1 and 255
  ),
  provider_event_at timestamptz,
  recorded_at timestamptz not null,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint payments_user_id_id_key unique (user_id, id),
  constraint payments_owned_invoice_fkey foreign key (user_id, invoice_id)
    references public.invoices(user_id, id) on delete restrict,
  check (refunded_cents <= amount_cents),
  check (
    (status = 'Succeeded' and refunded_cents = 0)
    or (status = 'Partially Refunded' and refunded_cents between 1 and amount_cents - 1)
    or (status = 'Refunded' and refunded_cents = amount_cents)
    or (status in ('Pending', 'Failed', 'Disputed') and refunded_cents = 0)
  ),
  check (
    (manual and method <> 'Stripe' and provider_payment_intent_id is null
      and provider_charge_id is null and provider_event_at is null)
    or (not manual and method = 'Stripe')
  )
);

create unique index payments_provider_intent_key
  on public.payments (provider_payment_intent_id)
  where provider_payment_intent_id is not null;
create unique index payments_provider_charge_key
  on public.payments (provider_charge_id)
  where provider_charge_id is not null;

create function public.fieldcraft_valid_reminder_occurrences(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'array' then false
    when jsonb_array_length(p_value) not between 1 and 3 then false
    else not exists (
      select 1 from jsonb_array_elements(p_value) as occurrence(value)
      where jsonb_typeof(occurrence.value) <> 'string'
        or occurrence.value #>> '{}' not in (
          'three-days-before', 'due', 'seven-days-overdue'
        )
    ) and jsonb_array_length(p_value) = (
      select count(distinct occurrence.value #>> '{}')
      from jsonb_array_elements(p_value) as occurrence(value)
    )
  end
$$;

revoke execute on function public.fieldcraft_valid_reminder_occurrences(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fieldcraft_valid_reminder_occurrences(jsonb)
  to service_role;

create table public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  active boolean not null default true,
  recipient_email text not null check (char_length(recipient_email) between 3 and 320),
  has_reminder_consent boolean not null default false,
  occurrences jsonb not null
    check (public.fieldcraft_valid_reminder_occurrences(occurrences)),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reminder_schedules_user_id_id_key unique (user_id, id),
  constraint reminder_schedules_owned_invoice_fkey foreign key (user_id, invoice_id)
    references public.invoices(user_id, id) on delete cascade,
  unique (user_id, invoice_id)
);

create table public.reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  schedule_id uuid not null,
  due_occurrence text not null check (
    due_occurrence in ('three-days-before', 'due', 'seven-days-overdue')
  ),
  status text not null default 'Pending' check (status in (
    'Pending', 'Claimed', 'Accepted by provider', 'Delivered', 'Bounced', 'Cancelled'
  )),
  provider_message_id text check (
    provider_message_id is null or char_length(provider_message_id) between 1 and 255
  ),
  claimed_until timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint reminder_deliveries_owned_invoice_fkey foreign key (user_id, invoice_id)
    references public.invoices(user_id, id) on delete cascade,
  constraint reminder_deliveries_owned_schedule_fkey foreign key (user_id, schedule_id)
    references public.reminder_schedules(user_id, id) on delete cascade,
  unique (invoice_id, schedule_id, due_occurrence)
);

create table public.payment_provider_event_receipts (
  provider text not null check (provider = 'stripe'),
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 255),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_id uuid not null,
  outcome text not null check (outcome in ('applied', 'duplicate', 'stale')),
  response jsonb not null,
  provider_event_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  retained_until timestamptz not null default (statement_timestamp() + interval '400 days'),
  primary key (provider, provider_event_id),
  check (retained_until >= created_at + interval '400 days')
);

create index estimates_user_status_updated_idx
  on public.estimates (user_id, status, updated_at desc, id);
create index payments_user_status_updated_idx
  on public.payments (user_id, status, updated_at desc, id);
create index payments_user_invoice_updated_idx
  on public.payments (user_id, invoice_id, updated_at desc, id);
create index reminder_schedules_user_active_updated_idx
  on public.reminder_schedules (user_id, active, updated_at desc, id);
create index reminder_deliveries_claim_idx
  on public.reminder_deliveries (status, claimed_until, created_at, id);
create index payment_provider_receipts_retention_idx
  on public.payment_provider_event_receipts (retained_until);

create trigger estimates_bump_version before update on public.estimates
for each row execute function public.bump_version_and_updated_at();
create trigger payments_bump_version before update on public.payments
for each row execute function public.bump_version_and_updated_at();
create trigger reminder_schedules_bump_version before update on public.reminder_schedules
for each row execute function public.bump_version_and_updated_at();

alter table public.estimates enable row level security;
alter table public.payments enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.reminder_deliveries enable row level security;
alter table public.payment_provider_event_receipts enable row level security;

create policy estimates_select_own on public.estimates for select
  using (auth.uid() = user_id);
create policy payments_select_own on public.payments for select
  using (auth.uid() = user_id);
create policy reminder_schedules_select_own on public.reminder_schedules for select
  using (auth.uid() = user_id);
create policy reminder_deliveries_select_own on public.reminder_deliveries for select
  using (auth.uid() = user_id);

revoke all on public.estimates, public.payments, public.reminder_schedules,
  public.reminder_deliveries, public.payment_provider_event_receipts
  from public, anon, authenticated;
grant select on public.estimates, public.payments, public.reminder_schedules,
  public.reminder_deliveries to authenticated;
grant all on public.estimates, public.payments, public.reminder_schedules,
  public.reminder_deliveries, public.payment_provider_event_receipts to service_role;

-- Synchronize only canonical user-owned entities. Delivery/provider receipts
-- remain server-operational data and are deliberately absent from the feed.
alter table public.sync_changes drop constraint if exists sync_changes_entity_check;
alter table public.sync_changes add constraint sync_changes_entity_check check (entity in (
  'profile', 'client', 'job', 'invoice', 'estimate', 'payment',
  'reminder_schedule', 'expense', 'service', 'inventory'
));

create or replace function public.capture_sync_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_entity text;
  v_user_id uuid;
  v_mutation_id uuid;
  v_change_seq bigint;
  v_payload jsonb;
  v_updated_at timestamptz := case
    when tg_op = 'DELETE' then clock_timestamp()
    else new.updated_at
  end;
begin
  v_entity := case tg_table_name
    when 'profiles' then 'profile'
    when 'clients' then 'client'
    when 'jobs' then 'job'
    when 'invoices' then 'invoice'
    when 'estimates' then 'estimate'
    when 'payments' then 'payment'
    when 'reminder_schedules' then 'reminder_schedule'
    when 'expenses' then 'expense'
    when 'services' then 'service'
    when 'inventory_items' then 'inventory'
    else null
  end;
  if v_entity is null then
    raise exception 'unsupported synchronization source table' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (
    to_jsonb(old) ->> 'id' is distinct from to_jsonb(new) ->> 'id'
    or case when tg_table_name = 'profiles' then to_jsonb(old) ->> 'id'
      else to_jsonb(old) ->> 'user_id' end
      is distinct from
      case when tg_table_name = 'profiles' then to_jsonb(new) ->> 'id'
      else to_jsonb(new) ->> 'user_id' end
  ) then
    raise exception 'synchronized entity and owner identities are immutable'
      using errcode = '22023';
  end if;
  v_user_id := case when tg_table_name = 'profiles'
    then (v_row ->> 'id')::uuid else (v_row ->> 'user_id')::uuid end;
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users as owner where owner.id = v_user_id
  ) then
    return old;
  end if;
  v_payload := case when tg_op = 'DELETE' then null else v_row end;
  if tg_op <> 'DELETE' and v_entity = 'invoice' then
    v_payload := v_row || jsonb_build_object(
      'clients', (
        select jsonb_build_object('name', client.name)
        from public.clients as client
        where client.user_id = v_user_id
          and client.id = (v_row ->> 'client_id')::uuid
      ),
      'jobs', (
        select jsonb_build_object(
          'title', job.title,
          'address', job.address,
          'description', job.description,
          'trade_type', job.trade_type
        )
        from public.jobs as job
        where job.user_id = v_user_id
          and job.id = nullif(v_row ->> 'job_id', '')::uuid
      )
    );
  end if;
  update public.sync_owner_counters as counter
  set last_change_seq = counter.last_change_seq + 1
  where counter.user_id = v_user_id
    and counter.writer_xid = pg_current_xact_id()
    and counter.last_change_seq < 9007199254740991
  returning counter.last_change_seq, counter.writer_mutation_id
  into v_change_seq, v_mutation_id;
  if v_change_seq is null then
    raise exception 'canonical synchronization writes require an owner writer lock'
      using errcode = '55000';
  end if;
  insert into public.sync_changes (
    user_id, change_seq, entity, entity_id, mutation_id,
    version, payload, deleted, updated_at
  ) values (
    v_user_id, v_change_seq, v_entity, (v_row ->> 'id')::uuid,
    v_mutation_id, (v_row ->> 'version')::bigint, v_payload,
    tg_op = 'DELETE', v_updated_at
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.capture_sync_change()
  from public, anon, authenticated;
create trigger estimates_capture_sync_change
after insert or update or delete on public.estimates
for each row execute function public.capture_sync_change();
create trigger payments_capture_sync_change
after insert or update or delete on public.payments
for each row execute function public.capture_sync_change();
create trigger reminder_schedules_capture_sync_change
after insert or update or delete on public.reminder_schedules
for each row execute function public.capture_sync_change();

create or replace function public.fieldcraft_owned_entity(
  p_user_id uuid,
  p_entity text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cloud jsonb;
begin
  case p_entity
    when 'profile' then select to_jsonb(profile) into v_cloud
      from public.profiles as profile where profile.id = p_user_id and profile.id = p_entity_id;
    when 'client' then select to_jsonb(client) into v_cloud
      from public.clients as client where client.user_id = p_user_id and client.id = p_entity_id;
    when 'job' then select to_jsonb(job) into v_cloud
      from public.jobs as job where job.user_id = p_user_id and job.id = p_entity_id;
    when 'invoice' then
      select to_jsonb(invoice) || jsonb_build_object(
        'clients', jsonb_build_object('name', client.name),
        'jobs', case when job.id is null then null else jsonb_build_object(
          'title', job.title, 'address', job.address,
          'description', job.description, 'trade_type', job.trade_type
        ) end
      ) into v_cloud
      from public.invoices as invoice
      join public.clients as client on client.user_id = invoice.user_id and client.id = invoice.client_id
      left join public.jobs as job on job.user_id = invoice.user_id and job.id = invoice.job_id
      where invoice.user_id = p_user_id and invoice.id = p_entity_id;
    when 'estimate' then select to_jsonb(estimate) into v_cloud
      from public.estimates as estimate where estimate.user_id = p_user_id and estimate.id = p_entity_id;
    when 'payment' then select to_jsonb(payment) into v_cloud
      from public.payments as payment where payment.user_id = p_user_id and payment.id = p_entity_id;
    when 'reminder_schedule' then select to_jsonb(schedule) into v_cloud
      from public.reminder_schedules as schedule where schedule.user_id = p_user_id and schedule.id = p_entity_id;
    when 'expense' then select to_jsonb(expense) into v_cloud
      from public.expenses as expense where expense.user_id = p_user_id and expense.id = p_entity_id;
    when 'service' then select to_jsonb(service) into v_cloud
      from public.services as service where service.user_id = p_user_id and service.id = p_entity_id;
    when 'inventory' then select to_jsonb(inventory) into v_cloud
      from public.inventory_items as inventory where inventory.user_id = p_user_id and inventory.id = p_entity_id;
    else raise exception 'unsupported entity' using errcode = '22023';
  end case;
  return v_cloud;
end;
$$;

revoke execute on function public.fieldcraft_owned_entity(uuid, text, uuid)
  from public, anon, authenticated;

create function public.fieldcraft_lifecycle_position(
  p_user_id uuid, p_mutation_id uuid, p_entity text, p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position jsonb;
begin
  select jsonb_build_object(
    'updated_at', change.updated_at,
    'change_seq', change.change_seq,
    'change_id', change.change_id,
    'source', 'sync_changes'
  ) into v_position
  from public.sync_changes as change
  where change.user_id = p_user_id
    and change.mutation_id = p_mutation_id
    and change.entity = p_entity
    and change.entity_id = p_entity_id
  order by change.change_seq desc
  limit 1;
  if v_position is null then
    raise exception 'lifecycle write did not produce a synchronization event'
      using errcode = '55000';
  end if;
  return v_position;
end
$$;

revoke execute on function public.fieldcraft_lifecycle_position(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function public.fieldcraft_valid_estimate_transition(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_from = p_to or (p_from, p_to) in (
    ('Draft', 'Issued'), ('Draft', 'Void'),
    ('Issued', 'Accepted'), ('Issued', 'Declined'),
    ('Issued', 'Expired'), ('Issued', 'Void'),
    ('Accepted', 'Converted'), ('Accepted', 'Void')
  )
$$;

revoke execute on function public.fieldcraft_valid_estimate_transition(text, text)
  from public, anon, authenticated, service_role;

create function public.save_estimate(p_mutation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_client_id uuid;
  v_base_version bigint;
  v_existing public.estimates%rowtype;
  v_status text;
  v_subtotal bigint;
  v_tax_basis_points integer;
  v_tax bigint;
  v_total bigint;
  v_cloud jsonb;
  v_response jsonb;
  v_count bigint;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
  v_previous_mutation_id text;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and estimate payload are required' using errcode = '22023';
  end if;
  v_estimate_id := public.require_jsonb_uuid(p_payload -> 'id', 'estimate.id');
  v_client_id := public.require_jsonb_uuid(p_payload -> 'clientId', 'estimate.clientId');
  if p_payload ->> 'ownerId' <> v_user_id::text then
    raise exception 'estimate owner does not match authentication' using errcode = '42501';
  end if;
  v_status := p_payload ->> 'status';
  if v_status not in ('Draft', 'Issued', 'Accepted', 'Declined', 'Expired', 'Void')
    or jsonb_typeof(p_payload -> 'title') <> 'string'
    or char_length(p_payload ->> 'title') not between 1 and 200
    or jsonb_typeof(p_payload -> 'scope') <> 'string'
    or char_length(p_payload ->> 'scope') not between 1 and 4000
    or not public.is_valid_invoice_line_items(p_payload -> 'lineItems')
  then raise exception 'estimate payload is invalid' using errcode = '22023'; end if;
  v_base_version := public.require_jsonb_integer(
    p_payload -> 'version', 'estimate.version', 0, 9223372036854775807
  );
  v_subtotal := public.invoice_subtotal_cents(p_payload -> 'lineItems');
  v_tax_basis_points := public.require_jsonb_integer(
    p_payload -> 'taxBasisPoints', 'estimate.taxBasisPoints', 0, 10000
  )::integer;
  v_tax := round((v_subtotal::numeric * v_tax_basis_points::numeric) / 10000)::bigint;
  v_total := v_subtotal + v_tax;
  if v_total > 100000000
    or public.require_jsonb_integer(p_payload -> 'subtotalCents', 'estimate.subtotalCents', 0, 100000000) <> v_subtotal
    or public.require_jsonb_integer(p_payload -> 'taxCents', 'estimate.taxCents', 0, 100000000) <> v_tax
    or public.require_jsonb_integer(p_payload -> 'totalCents', 'estimate.totalCents', 0, 100000000) <> v_total
  then raise exception 'estimate totals are invalid' using errcode = '22023'; end if;
  begin
    v_expires_at := (p_payload ->> 'expiresAt')::timestamptz;
    v_issued_at := nullif(p_payload ->> 'issuedAt', '')::timestamptz;
  exception when others then
    raise exception 'estimate timestamps are invalid' using errcode = '22023';
  end;
  if (v_status = 'Draft' and v_issued_at is not null)
    or (v_status <> 'Draft' and (
      v_issued_at is null or v_expires_at <= v_issued_at
      or nullif(p_payload ->> 'number', '') is null
    ))
  then raise exception 'estimate issuance fields are invalid' using errcode = '22023'; end if;

  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    if v_response ->> 'kind' <> 'save_estimate' then
      raise exception 'mutation ID belongs to a different operation' using errcode = '22023';
    end if;
    return v_response;
  end if;
  select * into v_existing from public.estimates as estimate
  where estimate.user_id = v_user_id and estimate.id = v_estimate_id for update;
  if found and v_existing.version <> v_base_version then
    raise exception 'STALE_BASE_VERSION' using errcode = '40001';
  elsif not found and v_base_version <> 0 then
    raise exception 'STALE_BASE_VERSION' using errcode = '40001';
  end if;
  if found and not public.fieldcraft_valid_estimate_transition(v_existing.status, v_status) then
    raise exception 'INVALID_ESTIMATE_TRANSITION' using errcode = '22023';
  end if;
  if found and v_existing.status <> 'Draft' and (
    v_existing.client_id <> v_client_id
    or v_existing.title <> p_payload ->> 'title'
    or v_existing.scope <> p_payload ->> 'scope'
    or v_existing.line_items <> p_payload -> 'lineItems'
    or v_existing.subtotal_cents <> v_subtotal
    or v_existing.tax_basis_points <> v_tax_basis_points
    or v_existing.tax_cents <> v_tax
    or v_existing.total_cents <> v_total
    or v_existing.number is distinct from nullif(p_payload ->> 'number', '')
    or v_existing.issued_at is distinct from v_issued_at
    or v_existing.expires_at is distinct from v_expires_at
  ) then raise exception 'ISSUED_ESTIMATE_IS_IMMUTABLE' using errcode = '22023'; end if;

  if not found then
    select count(*) into v_count from public.estimates where user_id = v_user_id;
    if v_count >= 10000 then raise exception 'PRO_ENTITY_CAP' using errcode = '54000'; end if;
  end if;
  if v_status = 'Issued' and (not found or v_existing.status = 'Draft') then
    select (
      (select count(*) from public.estimates as estimate
        where estimate.user_id = v_user_id and estimate.status in (
          'Issued', 'Accepted', 'Converted'
        ) and estimate.issued_at >= statement_timestamp() - interval '30 days')
      +
      (select count(*) from public.invoices as invoice
        where invoice.user_id = v_user_id and invoice.status in (
          'Issued', 'Viewed', 'Partially Paid', 'Paid'
        ) and coalesce(invoice.issued_at, invoice.sent_at, invoice.created_at)
          >= statement_timestamp() - interval '30 days')
    ) into v_count;
    if v_count >= 5 then
      perform public.fieldcraft_consume_admission(v_user_id, p_mutation_id, 'issue-document');
    end if;
  end if;

  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    if v_existing.id is null then
      insert into public.estimates as estimate (
        id, user_id, client_id, number, revision, status, title, scope,
        line_items, subtotal_cents, tax_basis_points, tax_cents, total_cents,
        expires_at, issued_at, accepted_at, acceptance_recorded_by,
        issued_snapshot, notes
      ) values (
        v_estimate_id, v_user_id, v_client_id, nullif(p_payload ->> 'number', ''),
        public.require_jsonb_integer(p_payload -> 'revision', 'estimate.revision', 1, 1000000),
        v_status, p_payload ->> 'title', p_payload ->> 'scope', p_payload -> 'lineItems',
        v_subtotal, v_tax_basis_points, v_tax, v_total, v_expires_at, v_issued_at,
        case when v_status = 'Accepted' then statement_timestamp() else null end,
        case when v_status = 'Accepted' then v_user_id else null end,
        case when v_status = 'Draft' then null else jsonb_build_object(
          'clientId', v_client_id, 'title', p_payload ->> 'title',
          'scope', p_payload ->> 'scope', 'lineItems', p_payload -> 'lineItems',
          'taxBasisPoints', v_tax_basis_points, 'subtotalCents', v_subtotal,
          'taxCents', v_tax, 'totalCents', v_total,
          'notes', nullif(p_payload ->> 'notes', '')
        ) end,
        nullif(p_payload ->> 'notes', '')
      ) returning to_jsonb(estimate) into v_cloud;
    elsif v_existing.status = 'Draft' then
      update public.estimates as estimate set
        client_id = v_client_id,
        number = nullif(p_payload ->> 'number', ''),
        revision = public.require_jsonb_integer(p_payload -> 'revision', 'estimate.revision', 1, 1000000),
        status = v_status,
        title = p_payload ->> 'title', scope = p_payload ->> 'scope',
        line_items = p_payload -> 'lineItems', subtotal_cents = v_subtotal,
        tax_basis_points = v_tax_basis_points, tax_cents = v_tax, total_cents = v_total,
        expires_at = v_expires_at, issued_at = v_issued_at,
        issued_snapshot = case when v_status = 'Draft' then null else jsonb_build_object(
          'clientId', v_client_id, 'title', p_payload ->> 'title',
          'scope', p_payload ->> 'scope', 'lineItems', p_payload -> 'lineItems',
          'taxBasisPoints', v_tax_basis_points, 'subtotalCents', v_subtotal,
          'taxCents', v_tax, 'totalCents', v_total,
          'notes', nullif(p_payload ->> 'notes', '')
        ) end,
        notes = nullif(p_payload ->> 'notes', '')
      where estimate.user_id = v_user_id and estimate.id = v_estimate_id
      returning to_jsonb(estimate) into v_cloud;
    else
      update public.estimates as estimate set
        status = v_status,
        accepted_at = case when v_status = 'Accepted' then statement_timestamp() else null end,
        acceptance_recorded_by = case when v_status = 'Accepted' then v_user_id else null end
      where estimate.user_id = v_user_id and estimate.id = v_estimate_id
      returning to_jsonb(estimate) into v_cloud;
    end if;
  exception when others then
    perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  v_response := jsonb_build_object(
    'status', 'applied', 'mutation_id', p_mutation_id,
    'entity', 'estimate', 'kind', 'save_estimate', 'entity_id', v_estimate_id,
    'cloud', v_cloud,
    'sync_position', public.fieldcraft_lifecycle_position(
      v_user_id, p_mutation_id, 'estimate', v_estimate_id
    )
  );
  insert into public.mutation_receipts(user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end
$$;

revoke execute on function public.save_estimate(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.save_estimate(uuid, jsonb) to authenticated;

create function public.convert_estimate(p_mutation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate_id uuid;
  v_job_id uuid;
  v_base_version bigint;
  v_estimate public.estimates%rowtype;
  v_estimate_cloud jsonb;
  v_job_cloud jsonb;
  v_response jsonb;
  v_previous_mutation_id text;
  v_count bigint;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and conversion payload are required' using errcode = '22023';
  end if;
  v_estimate_id := public.require_jsonb_uuid(p_payload -> 'estimateId', 'estimateId');
  v_job_id := public.require_jsonb_uuid(p_payload -> 'jobId', 'jobId');
  v_base_version := public.require_jsonb_integer(p_payload -> 'baseVersion', 'baseVersion', 1, 9223372036854775807);
  perform (p_payload ->> 'now')::timestamptz;
  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    if v_response ->> 'kind' <> 'convert_estimate' then
      raise exception 'mutation ID belongs to a different operation' using errcode = '22023';
    end if;
    return v_response;
  end if;
  select * into v_estimate from public.estimates as estimate
  where estimate.user_id = v_user_id and estimate.id = v_estimate_id for update;
  if not found or v_estimate.version <> v_base_version then
    raise exception 'STALE_BASE_VERSION' using errcode = '40001';
  end if;
  if v_estimate.status <> 'Accepted' or v_estimate.converted_job_id is not null then
    raise exception 'INVALID_ESTIMATE_TRANSITION' using errcode = '22023';
  end if;
  if exists (select 1 from public.jobs where id = v_job_id) then
    raise exception 'conversion job already exists' using errcode = '23505';
  end if;
  select count(*) into v_count from public.jobs where user_id = v_user_id;
  if v_count >= 10000 then raise exception 'PRO_ENTITY_CAP' using errcode = '54000'; end if;

  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    insert into public.jobs as job (
      id, user_id, client_id, title, description, trade_type, status
    ) values (
      v_job_id, v_user_id, v_estimate.client_id, v_estimate.title,
      v_estimate.scope, 'General', 'In Progress'
    ) returning to_jsonb(job) into v_job_cloud;
    update public.estimates as estimate
    set status = 'Converted', converted_job_id = v_job_id
    where estimate.user_id = v_user_id and estimate.id = v_estimate_id
    returning to_jsonb(estimate) into v_estimate_cloud;
  exception when others then
    perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  v_response := jsonb_build_object(
    'status', 'applied', 'mutation_id', p_mutation_id,
    'entity', 'estimate', 'kind', 'convert_estimate', 'entity_id', v_estimate_id,
    'cloud', v_estimate_cloud,
    'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'estimate', v_estimate_id),
    'cloud_rows', jsonb_build_array(
      jsonb_build_object(
        'entity', 'job', 'cloud', v_job_cloud,
        'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'job', v_job_id)
      )
    )
  );
  insert into public.mutation_receipts(user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end
$$;

revoke execute on function public.convert_estimate(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.convert_estimate(uuid, jsonb) to authenticated;

create function public.issue_invoice(p_mutation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_invoice_id uuid;
  v_base_version bigint;
  v_invoice public.invoices%rowtype;
  v_cloud jsonb;
  v_response jsonb;
  v_issued_at timestamptz;
  v_due_at timestamptz;
  v_count bigint;
  v_previous_mutation_id text;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and invoice issuance payload are required' using errcode = '22023';
  end if;
  v_invoice_id := public.require_jsonb_uuid(p_payload -> 'invoiceId', 'invoiceId');
  v_base_version := public.require_jsonb_integer(p_payload -> 'baseVersion', 'baseVersion', 1, 9223372036854775807);
  begin
    v_issued_at := (p_payload ->> 'issuedAt')::timestamptz;
    v_due_at := (p_payload ->> 'dueAt')::timestamptz;
  exception when others then raise exception 'invoice timestamps are invalid' using errcode = '22023'; end;
  if v_due_at < v_issued_at then raise exception 'invoice due time precedes issue time' using errcode = '22023'; end if;
  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    if v_response ->> 'kind' <> 'issue_invoice' then
      raise exception 'mutation ID belongs to a different operation' using errcode = '22023';
    end if;
    return v_response;
  end if;
  select * into v_invoice from public.invoices as invoice
  where invoice.user_id = v_user_id and invoice.id = v_invoice_id for update;
  if not found or v_invoice.version <> v_base_version then
    raise exception 'STALE_BASE_VERSION' using errcode = '40001';
  end if;
  if v_invoice.status <> 'Draft' then raise exception 'INVALID_INVOICE_TRANSITION' using errcode = '22023'; end if;
  select (
    (select count(*) from public.estimates as estimate
      where estimate.user_id = v_user_id and estimate.status in ('Issued', 'Accepted', 'Converted')
        and estimate.issued_at >= statement_timestamp() - interval '30 days')
    +
    (select count(*) from public.invoices as invoice
      where invoice.user_id = v_user_id and invoice.status in ('Issued', 'Viewed', 'Partially Paid', 'Paid')
        and coalesce(invoice.issued_at, invoice.sent_at, invoice.created_at)
          >= statement_timestamp() - interval '30 days')
  ) into v_count;
  if v_count >= 5 then
    perform public.fieldcraft_consume_admission(v_user_id, p_mutation_id, 'issue-document');
  end if;
  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    update public.invoices as invoice set
      status = 'Issued', issued_at = v_issued_at, sent_at = v_issued_at,
      due_at = v_due_at, paid_cents = 0, balance_cents = total_cents
    where invoice.user_id = v_user_id and invoice.id = v_invoice_id
    returning public.fieldcraft_owned_entity(v_user_id, 'invoice', invoice.id) into v_cloud;
  exception when others then
    perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  v_cloud := public.fieldcraft_owned_entity(v_user_id, 'invoice', v_invoice_id);
  v_response := jsonb_build_object(
    'status', 'applied', 'mutation_id', p_mutation_id,
    'entity', 'invoice', 'kind', 'issue_invoice', 'entity_id', v_invoice_id,
    'cloud', v_cloud,
    'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'invoice', v_invoice_id)
  );
  insert into public.mutation_receipts(user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end
$$;

revoke execute on function public.issue_invoice(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.issue_invoice(uuid, jsonb) to authenticated;

create function public.fieldcraft_recompute_invoice_payment(
  p_user_id uuid, p_invoice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.invoices%rowtype;
  v_paid bigint;
  v_cloud jsonb;
begin
  select * into v_invoice from public.invoices as invoice
  where invoice.user_id = p_user_id and invoice.id = p_invoice_id for update;
  if not found then raise exception 'invoice was not found' using errcode = '22023'; end if;
  select coalesce(sum(case
    when payment.status = 'Succeeded' then payment.amount_cents
    when payment.status = 'Partially Refunded' then payment.amount_cents - payment.refunded_cents
    else 0 end), 0)
  into v_paid from public.payments as payment
  where payment.user_id = p_user_id and payment.invoice_id = p_invoice_id;
  if v_paid > v_invoice.total_cents then raise exception 'PAYMENT_EXCEEDS_BALANCE' using errcode = '22023'; end if;
  update public.invoices as invoice set
    paid_cents = v_paid,
    balance_cents = invoice.total_cents - v_paid,
    status = case
      when v_paid = 0 then 'Issued'
      when v_paid = invoice.total_cents then 'Paid'
      else 'Partially Paid'
    end,
    paid_at = case when v_paid = invoice.total_cents then statement_timestamp() else null end
  where invoice.user_id = p_user_id and invoice.id = p_invoice_id;
  if v_invoice.job_id is not null then
    update public.jobs as job set status = case
      when v_paid = v_invoice.total_cents then 'Paid'
      when v_paid > 0 then 'Partially Paid'
      else 'Invoiced'
    end
    where job.user_id = p_user_id and job.id = v_invoice.job_id
      and job.status <> 'Cancelled';
  end if;
  v_cloud := public.fieldcraft_owned_entity(p_user_id, 'invoice', p_invoice_id);
  return v_cloud;
end
$$;

revoke execute on function public.fieldcraft_recompute_invoice_payment(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.record_manual_payment(p_mutation_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment_id uuid;
  v_invoice_id uuid;
  v_amount bigint;
  v_base_version bigint;
  v_invoice public.invoices%rowtype;
  v_payment_cloud jsonb;
  v_invoice_cloud jsonb;
  v_job_cloud jsonb;
  v_response jsonb;
  v_recorded_at timestamptz;
  v_previous_mutation_id text;
  v_count bigint;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform public.fieldcraft_require_aal2();
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and manual payment payload are required' using errcode = '22023';
  end if;
  v_payment_id := public.require_jsonb_uuid(p_payload -> 'paymentId', 'paymentId');
  v_invoice_id := public.require_jsonb_uuid(p_payload -> 'invoiceId', 'invoiceId');
  v_amount := public.require_jsonb_integer(p_payload -> 'amountCents', 'amountCents', 1, 100000000);
  v_base_version := public.require_jsonb_integer(p_payload -> 'baseVersion', 'baseVersion', 1, 9223372036854775807);
  if p_payload ->> 'currency' <> 'USD'
    or p_payload ->> 'method' not in ('Cash', 'Check', 'Bank Transfer', 'Other')
    or char_length(coalesce(p_payload ->> 'note', '')) > 1000
  then raise exception 'manual payment payload is invalid' using errcode = '22023'; end if;
  begin v_recorded_at := (p_payload ->> 'recordedAt')::timestamptz;
  exception when others then raise exception 'payment timestamp is invalid' using errcode = '22023'; end;
  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    if v_response ->> 'kind' <> 'record_manual_payment' then
      raise exception 'mutation ID belongs to a different operation' using errcode = '22023';
    end if;
    return v_response;
  end if;
  select * into v_invoice from public.invoices as invoice
  where invoice.user_id = v_user_id and invoice.id = v_invoice_id for update;
  if not found or v_invoice.version <> v_base_version then
    raise exception 'STALE_BASE_VERSION' using errcode = '40001';
  end if;
  if v_invoice.status not in ('Issued', 'Viewed', 'Partially Paid')
    or v_amount > v_invoice.balance_cents
  then raise exception 'PAYMENT_EXCEEDS_BALANCE' using errcode = '22023'; end if;
  select count(*) into v_count from public.payments where user_id = v_user_id;
  if v_count >= 10000 then raise exception 'PRO_ENTITY_CAP' using errcode = '54000'; end if;
  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    insert into public.payments as payment (
      id, user_id, invoice_id, amount_cents, currency, method,
      status, refunded_cents, manual, note, recorded_at
    ) values (
      v_payment_id, v_user_id, v_invoice_id, v_amount, 'USD', p_payload ->> 'method',
      'Succeeded', 0, true, nullif(p_payload ->> 'note', ''), v_recorded_at
    ) returning to_jsonb(payment) into v_payment_cloud;
    v_invoice_cloud := public.fieldcraft_recompute_invoice_payment(v_user_id, v_invoice_id);
    if v_invoice.job_id is not null then
      v_job_cloud := public.fieldcraft_owned_entity(v_user_id, 'job', v_invoice.job_id);
    end if;
  exception when others then
    perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  v_response := jsonb_build_object(
    'status', 'applied', 'mutation_id', p_mutation_id,
    'entity', 'payment', 'kind', 'record_manual_payment', 'entity_id', v_payment_id,
    'cloud', v_payment_cloud,
    'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'payment', v_payment_id),
    'cloud_rows', jsonb_build_array(
      jsonb_build_object('entity', 'invoice', 'cloud', v_invoice_cloud,
        'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'invoice', v_invoice_id))
    ) || case when v_job_cloud is null then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('entity', 'job', 'cloud', v_job_cloud,
        'sync_position', public.fieldcraft_lifecycle_position(v_user_id, p_mutation_id, 'job', v_invoice.job_id))
    ) end
  );
  insert into public.mutation_receipts(user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end
$$;

revoke execute on function public.record_manual_payment(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.record_manual_payment(uuid, jsonb) to authenticated;

create function public.apply_provider_payment_event(
  p_provider_event_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_payment_id uuid;
  v_invoice_id uuid;
  v_amount bigint;
  v_refunded bigint;
  v_status text;
  v_provider_event_at timestamptz;
  v_existing public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_response jsonb;
  v_payment_cloud jsonb;
begin
  -- EXECUTE is granted only to the platform service role below. Checking
  -- current_user inside this SECURITY DEFINER function would observe the
  -- function owner, not the caller, so grants are the authoritative boundary.
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 1 and 255
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
  then raise exception 'provider event is invalid' using errcode = '22023'; end if;
  select receipt.response into v_response
  from public.payment_provider_event_receipts as receipt
  where receipt.provider = 'stripe' and receipt.provider_event_id = p_provider_event_id;
  if found then return v_response || jsonb_build_object('outcome', 'duplicate'); end if;
  v_user_id := public.require_jsonb_uuid(p_payload -> 'userId', 'userId');
  v_payment_id := public.require_jsonb_uuid(p_payload -> 'paymentId', 'paymentId');
  v_invoice_id := public.require_jsonb_uuid(p_payload -> 'invoiceId', 'invoiceId');
  v_amount := public.require_jsonb_integer(p_payload -> 'amountCents', 'amountCents', 1, 100000000);
  v_refunded := public.require_jsonb_integer(p_payload -> 'refundedCents', 'refundedCents', 0, v_amount);
  v_status := p_payload ->> 'status';
  if p_payload ->> 'currency' <> 'USD'
    or v_status not in ('Pending', 'Succeeded', 'Failed', 'Partially Refunded', 'Refunded', 'Disputed')
    or (v_status = 'Succeeded' and v_refunded <> 0)
    or (v_status = 'Partially Refunded' and v_refunded not between 1 and v_amount - 1)
    or (v_status = 'Refunded' and v_refunded <> v_amount)
    or (v_status in ('Pending', 'Failed', 'Disputed') and v_refunded <> 0)
  then raise exception 'provider payment state is invalid' using errcode = '22023'; end if;
  begin v_provider_event_at := (p_payload ->> 'providerEventAt')::timestamptz;
  exception when others then raise exception 'provider event timestamp is invalid' using errcode = '22023'; end;
  perform public.fieldcraft_lock_sync_owner(v_user_id, null);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || v_payment_id::text, 0));
  select * into v_invoice from public.invoices as invoice
  where invoice.user_id = v_user_id and invoice.id = v_invoice_id for update;
  if not found then raise exception 'invoice was not found' using errcode = '22023'; end if;
  select * into v_existing from public.payments as payment
  where payment.user_id = v_user_id and payment.id = v_payment_id for update;
  if found and v_provider_event_at < v_existing.provider_event_at then
    v_response := jsonb_build_object('outcome', 'stale', 'payment_id', v_payment_id);
  else
    if not found then
      if v_status not in ('Pending', 'Succeeded') then
        raise exception 'provider payment must start pending or succeeded' using errcode = '22023';
      end if;
      insert into public.payments as payment (
        id, user_id, invoice_id, amount_cents, currency, method, status,
        refunded_cents, manual, provider_payment_intent_id,
        provider_charge_id, provider_event_at, recorded_at
      ) values (
        v_payment_id, v_user_id, v_invoice_id, v_amount, 'USD', 'Stripe', v_status,
        v_refunded, false, nullif(p_payload ->> 'providerPaymentIntentId', ''),
        nullif(p_payload ->> 'providerChargeId', ''), v_provider_event_at, v_provider_event_at
      ) returning to_jsonb(payment) into v_payment_cloud;
    else
      if v_existing.invoice_id <> v_invoice_id or v_existing.amount_cents <> v_amount
        or v_existing.currency <> 'USD' or v_existing.manual
      then raise exception 'provider payment identity is immutable' using errcode = '22023'; end if;
      update public.payments as payment set
        status = v_status, refunded_cents = v_refunded,
        provider_charge_id = coalesce(nullif(p_payload ->> 'providerChargeId', ''), payment.provider_charge_id),
        provider_payment_intent_id = coalesce(nullif(p_payload ->> 'providerPaymentIntentId', ''), payment.provider_payment_intent_id),
        provider_event_at = v_provider_event_at
      where payment.user_id = v_user_id and payment.id = v_payment_id
      returning to_jsonb(payment) into v_payment_cloud;
    end if;
    perform public.fieldcraft_recompute_invoice_payment(v_user_id, v_invoice_id);
    v_response := jsonb_build_object('outcome', 'applied', 'payment_id', v_payment_id, 'cloud', v_payment_cloud);
  end if;
  insert into public.payment_provider_event_receipts (
    provider, provider_event_id, user_id, payment_id, outcome,
    response, provider_event_at
  ) values (
    'stripe', p_provider_event_id, v_user_id, v_payment_id,
    v_response ->> 'outcome', v_response, v_provider_event_at
  );
  return v_response;
end
$$;

revoke execute on function public.apply_provider_payment_event(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_provider_payment_event(text, jsonb)
  to service_role;

-- Keep the legacy CRUD surface for draft records, but move its issuance limit
-- to the canonical `Issued` vocabulary so an update cannot bypass admission.
alter function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb)
  rename to apply_entity_mutation_v3_internal;
revoke execute on function public.apply_entity_mutation_v3_internal(
  uuid, text, text, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;

create function public.apply_entity_mutation(
  p_mutation_id uuid,
  p_entity text,
  p_kind text,
  p_entity_id uuid,
  p_base_version bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_status text;
  v_requires_capacity boolean := false;
  v_count bigint;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  if p_entity = 'invoice'
    and p_payload ->> 'status' in ('Issued', 'Viewed', 'Partially Paid', 'Paid')
  then
    v_requires_capacity := p_kind = 'create';
    if p_kind = 'update' then
      select invoice.status into v_existing_status
      from public.invoices as invoice
      where invoice.user_id = v_user_id and invoice.id = p_entity_id;
      v_requires_capacity := found and v_existing_status not in (
        'Issued', 'Viewed', 'Partially Paid', 'Paid'
      );
    end if;
    if v_requires_capacity then
      select (
        (select count(*) from public.estimates as estimate
          where estimate.user_id = v_user_id
            and estimate.status in ('Issued', 'Accepted', 'Converted')
            and estimate.issued_at >= statement_timestamp() - interval '30 days')
        +
        (select count(*) from public.invoices as invoice
          where invoice.user_id = v_user_id
            and invoice.status in ('Issued', 'Viewed', 'Partially Paid', 'Paid')
            and coalesce(invoice.issued_at, invoice.sent_at, invoice.created_at)
              >= statement_timestamp() - interval '30 days')
      ) into v_count;
      if v_count >= 5 then
        perform public.fieldcraft_consume_admission(v_user_id, p_mutation_id, 'issue-document');
      end if;
    end if;
  end if;
  return public.apply_entity_mutation_v3_internal(
    p_mutation_id, p_entity, p_kind, p_entity_id,
    p_base_version, p_payload
  );
end
$$;

revoke execute on function public.apply_entity_mutation(
  uuid, text, text, uuid, bigint, jsonb
) from public, anon, service_role;
grant execute on function public.apply_entity_mutation(
  uuid, text, text, uuid, bigint, jsonb
) to authenticated;
