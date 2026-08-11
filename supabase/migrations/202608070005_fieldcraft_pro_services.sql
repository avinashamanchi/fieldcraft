begin;

create table public.stripe_connected_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  connected_account_id text not null unique
    check (connected_account_id ~ '^acct_[A-Za-z0-9]{3,255}$'),
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  requirements_state text not null
    check (requirements_state in ('pending', 'restricted', 'complete')),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.invoice_payment_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint invoice_payment_links_owned_invoice_fkey
    foreign key (user_id, invoice_id) references public.invoices(user_id, id)
    on delete cascade,
  check (expires_at > created_at and (revoked_at is null or revoked_at >= created_at))
);

create unique index invoice_payment_links_one_active_idx
  on public.invoice_payment_links(user_id, invoice_id) where revoked_at is null;
create index invoice_payment_links_expiry_idx
  on public.invoice_payment_links(expires_at) where revoked_at is null;

create table public.reminder_provider_event_receipts (
  provider_event_id text primary key
    check (char_length(provider_event_id) between 1 and 255),
  delivery_id uuid not null references public.reminder_deliveries(id) on delete cascade,
  outcome text not null check (outcome in ('applied', 'stale')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  retained_until timestamptz not null default (statement_timestamp() + interval '400 days'),
  check (retained_until >= created_at + interval '400 days')
);

alter table public.reminder_deliveries
  add column provider_event_at timestamptz;

create unique index reminder_delivery_occurrence_idx
  on public.reminder_deliveries(invoice_id, schedule_id, due_occurrence);
create unique index reminder_delivery_provider_message_idx
  on public.reminder_deliveries(provider_message_id)
  where provider_message_id is not null;
create index reminder_provider_receipts_retention_idx
  on public.reminder_provider_event_receipts(retained_until);

alter table public.stripe_connected_accounts enable row level security;
alter table public.invoice_payment_links enable row level security;
alter table public.reminder_provider_event_receipts enable row level security;
create policy stripe_connected_accounts_select_own
  on public.stripe_connected_accounts for select using (auth.uid() = user_id);
create policy invoice_payment_links_select_own
  on public.invoice_payment_links for select using (auth.uid() = user_id);

revoke all on public.stripe_connected_accounts, public.invoice_payment_links,
  public.reminder_provider_event_receipts from public, anon, authenticated;
grant select on public.stripe_connected_accounts, public.invoice_payment_links
  to authenticated;
grant all on public.stripe_connected_accounts, public.invoice_payment_links,
  public.reminder_provider_event_receipts to service_role;

create function public.fieldcraft_require_pro()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_active boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select public.fieldcraft_entitlement_is_active(
    entitlement.status, entitlement.provider_active,
    entitlement.expires_at, statement_timestamp()
  ) into v_active
  from public.subscription_entitlements as entitlement
  where entitlement.user_id = v_user_id;
  if not coalesce(v_active, false) then
    raise exception 'PRO_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('active', true);
end
$$;
revoke execute on function public.fieldcraft_require_pro()
  from public, anon, service_role;
grant execute on function public.fieldcraft_require_pro() to authenticated;

create function public.fieldcraft_get_stripe_account(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select case when account.user_id is null then null else jsonb_build_object(
    'connectedAccountId', account.connected_account_id,
    'chargesEnabled', account.charges_enabled,
    'payoutsEnabled', account.payouts_enabled,
    'requirementsState', account.requirements_state
  ) end
  from (select p_user_id as requested_user) as requested
  left join public.stripe_connected_accounts as account
    on account.user_id = requested.requested_user
$$;
revoke execute on function public.fieldcraft_get_stripe_account(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_get_stripe_account(uuid) to service_role;

create function public.fieldcraft_upsert_stripe_account(
  p_user_id uuid, p_connected_account_id text, p_charges_enabled boolean,
  p_payouts_enabled boolean, p_requirements_state text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_connected_account_id !~ '^acct_[A-Za-z0-9]{3,255}$'
    or p_charges_enabled is null or p_payouts_enabled is null
    or p_requirements_state not in ('pending', 'restricted', 'complete')
  then raise exception 'invalid connected account' using errcode = '22023'; end if;
  insert into public.stripe_connected_accounts as account (
    user_id, connected_account_id, charges_enabled, payouts_enabled,
    requirements_state
  ) values (
    p_user_id, p_connected_account_id, p_charges_enabled,
    p_payouts_enabled, p_requirements_state
  ) on conflict (user_id) do update set
    connected_account_id = excluded.connected_account_id,
    charges_enabled = excluded.charges_enabled,
    payouts_enabled = excluded.payouts_enabled,
    requirements_state = excluded.requirements_state,
    updated_at = statement_timestamp();
end
$$;
revoke execute on function public.fieldcraft_upsert_stripe_account(
  uuid, text, boolean, boolean, text
) from public, anon, authenticated;
grant execute on function public.fieldcraft_upsert_stripe_account(
  uuid, text, boolean, boolean, text
) to service_role;

create function public.fieldcraft_delete_stripe_account(
  p_user_id uuid, p_connected_account_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.stripe_connected_accounts as account
  where account.user_id = p_user_id
    and account.connected_account_id = p_connected_account_id;
end
$$;
revoke execute on function public.fieldcraft_delete_stripe_account(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_delete_stripe_account(uuid, text)
  to service_role;

create function public.fieldcraft_owner_has_pro(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(public.fieldcraft_entitlement_is_active(
    entitlement.status, entitlement.provider_active,
    entitlement.expires_at, statement_timestamp()
  ), false)
  from (select p_user_id as requested_user) as requested
  left join public.subscription_entitlements as entitlement
    on entitlement.user_id = requested.requested_user
$$;
revoke execute on function public.fieldcraft_owner_has_pro(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_owner_has_pro(uuid) to service_role;

create function public.fieldcraft_issue_payment_link(
  p_user_id uuid, p_invoice_id uuid, p_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.invoice_payment_links%rowtype;
begin
  if p_user_id is null or p_invoice_id is null
    or p_token_hash_hex !~ '^[0-9a-f]{64}$'
  then raise exception 'invalid payment link request' using errcode = '22023'; end if;
  if not public.fieldcraft_owner_has_pro(p_user_id) then
    raise exception 'PRO_REQUIRED' using errcode = '42501';
  end if;
  perform 1 from public.invoices as invoice
  join public.stripe_connected_accounts as account
    on account.user_id = invoice.user_id and account.charges_enabled
  where invoice.user_id = p_user_id and invoice.id = p_invoice_id
    and invoice.status in ('Issued', 'Viewed', 'Partially Paid')
    and invoice.balance_cents >= 99;
  if not found then raise exception 'invoice is not payable' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_invoice_id::text, 0));
  update public.invoice_payment_links as link set revoked_at = statement_timestamp()
  where link.user_id = p_user_id and link.invoice_id = p_invoice_id
    and link.revoked_at is null;
  insert into public.invoice_payment_links(user_id, invoice_id, token_hash, expires_at)
  values (p_user_id, p_invoice_id, decode(p_token_hash_hex, 'hex'), statement_timestamp() + interval '30 days')
  returning * into v_link;
  return jsonb_build_object('linkId', v_link.id, 'expiresAt', v_link.expires_at);
end
$$;
revoke execute on function public.fieldcraft_issue_payment_link(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_issue_payment_link(uuid, uuid, text)
  to service_role;

create function public.fieldcraft_revoke_payment_link(
  p_user_id uuid, p_invoice_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.invoice_payment_links as link
  set revoked_at = coalesce(link.revoked_at, statement_timestamp())
  where link.user_id = p_user_id and link.invoice_id = p_invoice_id
$$;
revoke execute on function public.fieldcraft_revoke_payment_link(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_revoke_payment_link(uuid, uuid)
  to service_role;

create function public.fieldcraft_resolve_payment_link(p_token_hash_hex text)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare v_result jsonb;
begin
  if p_token_hash_hex !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'businessName', profile.business_name,
    'invoiceNumber', invoice.number,
    'currency', 'USD',
    'totalCents', invoice.total_cents,
    'paidCents', invoice.paid_cents,
    'balanceCents', invoice.balance_cents,
    'minimumCents', 99,
    'maximumCents', invoice.balance_cents
  ) into v_result
  from public.invoice_payment_links as link
  join public.invoices as invoice
    on invoice.user_id = link.user_id and invoice.id = link.invoice_id
  join public.profiles as profile on profile.id = link.user_id
  join public.stripe_connected_accounts as account
    on account.user_id = link.user_id and account.charges_enabled
  where link.token_hash = decode(p_token_hash_hex, 'hex')
    and link.revoked_at is null and link.expires_at > statement_timestamp()
    and invoice.status in ('Issued', 'Viewed', 'Partially Paid')
    and invoice.balance_cents >= 99
    and public.fieldcraft_owner_has_pro(link.user_id);
  return v_result;
end
$$;
revoke execute on function public.fieldcraft_resolve_payment_link(text)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_resolve_payment_link(text)
  to service_role;

create function public.fieldcraft_resolve_payment_link_checkout(
  p_token_hash_hex text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare v_result jsonb;
begin
  if p_token_hash_hex !~ '^[0-9a-f]{64}$' then return null; end if;
  select jsonb_build_object(
    'linkId', link.id,
    'ownerId', link.user_id,
    'invoiceId', invoice.id,
    'number', invoice.number,
    'balanceCents', invoice.balance_cents,
    'currency', 'USD',
    'connectedAccountId', account.connected_account_id,
    'chargesEnabled', account.charges_enabled
  ) into v_result
  from public.invoice_payment_links as link
  join public.invoices as invoice
    on invoice.user_id = link.user_id and invoice.id = link.invoice_id
  join public.stripe_connected_accounts as account on account.user_id = link.user_id
  where link.token_hash = decode(p_token_hash_hex, 'hex')
    and link.revoked_at is null and link.expires_at > statement_timestamp()
    and invoice.status in ('Issued', 'Viewed', 'Partially Paid')
    and invoice.balance_cents >= 99 and account.charges_enabled
    and public.fieldcraft_owner_has_pro(link.user_id);
  return v_result;
end
$$;
revoke execute on function public.fieldcraft_resolve_payment_link_checkout(text)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_resolve_payment_link_checkout(text)
  to service_role;

create function public.fieldcraft_claim_reminders(p_limit integer default 100)
returns table (
  id uuid, "recipientEmail" text, "businessName" text,
  "invoiceNumber" text, "balanceCents" bigint,
  "dueOccurrence" text, "replyTo" text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 then
    raise exception 'invalid reminder claim limit' using errcode = '22023';
  end if;
  insert into public.reminder_deliveries(
    user_id, invoice_id, schedule_id, due_occurrence
  )
  select schedule.user_id, schedule.invoice_id, schedule.id,
    occurrence.value #>> '{}'
  from public.reminder_schedules as schedule
  join public.invoices as invoice
    on invoice.user_id = schedule.user_id and invoice.id = schedule.invoice_id
  cross join jsonb_array_elements(schedule.occurrences) as occurrence(value)
  where schedule.active and schedule.has_reminder_consent
    and invoice.status in ('Issued', 'Viewed', 'Partially Paid')
    and invoice.balance_cents > 0 and invoice.due_at is not null
    and public.fieldcraft_owner_has_pro(schedule.user_id)
    and case occurrence.value #>> '{}'
      when 'three-days-before' then invoice.due_at - interval '3 days' <= statement_timestamp()
      when 'due' then invoice.due_at <= statement_timestamp()
      when 'seven-days-overdue' then invoice.due_at + interval '7 days' <= statement_timestamp()
      else false end
    and schedule.created_at <= case occurrence.value #>> '{}'
      when 'three-days-before' then invoice.due_at - interval '3 days'
      when 'due' then invoice.due_at
      when 'seven-days-overdue' then invoice.due_at + interval '7 days'
      else statement_timestamp() end
  on conflict (invoice_id, schedule_id, due_occurrence) do nothing;

  return query
  with candidates as (
    select delivery.id
    from public.reminder_deliveries as delivery
    where delivery.status = 'Pending'
      or (delivery.status = 'Claimed' and delivery.claimed_until < statement_timestamp())
    order by delivery.created_at, delivery.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.reminder_deliveries as delivery set
      status = 'Claimed', claimed_until = statement_timestamp() + interval '5 minutes',
      updated_at = statement_timestamp()
    from candidates where delivery.id = candidates.id
    returning delivery.*
  )
  select claimed.id, schedule.recipient_email, profile.business_name,
    invoice.number, invoice.balance_cents, claimed.due_occurrence,
    profile.email
  from claimed
  join public.reminder_schedules as schedule on schedule.id = claimed.schedule_id
  join public.invoices as invoice
    on invoice.user_id = claimed.user_id and invoice.id = claimed.invoice_id
  join public.profiles as profile on profile.id = claimed.user_id;
end
$$;
revoke execute on function public.fieldcraft_claim_reminders(integer)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_claim_reminders(integer)
  to service_role;

create function public.fieldcraft_recheck_reminder(p_delivery_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object('eligible', exists (
    select 1
    from public.reminder_deliveries as delivery
    join public.reminder_schedules as schedule
      on schedule.user_id = delivery.user_id and schedule.id = delivery.schedule_id
    join public.invoices as invoice
      on invoice.user_id = delivery.user_id and invoice.id = delivery.invoice_id
    where delivery.id = p_delivery_id and delivery.status = 'Claimed'
      and delivery.claimed_until >= statement_timestamp()
      and schedule.active and schedule.has_reminder_consent
      and invoice.status in ('Issued', 'Viewed', 'Partially Paid')
      and invoice.balance_cents > 0
      and public.fieldcraft_owner_has_pro(delivery.user_id)
  ))
$$;
revoke execute on function public.fieldcraft_recheck_reminder(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_recheck_reminder(uuid) to service_role;

create function public.fieldcraft_accept_reminder(
  p_delivery_id uuid, p_provider_message_id text, p_accepted_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provider_message_id is null
    or char_length(p_provider_message_id) not between 1 and 255
    or p_accepted_at is null
  then raise exception 'invalid reminder acceptance' using errcode = '22023'; end if;
  update public.reminder_deliveries as delivery set
    status = 'Accepted by provider', provider_message_id = p_provider_message_id,
    accepted_at = p_accepted_at, claimed_until = null,
    updated_at = statement_timestamp()
  where delivery.id = p_delivery_id and delivery.status = 'Claimed'
    and delivery.claimed_until >= statement_timestamp();
  if not found then raise exception 'reminder lease was lost' using errcode = '40001'; end if;
end
$$;
revoke execute on function public.fieldcraft_accept_reminder(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_accept_reminder(uuid, text, timestamptz)
  to service_role;

create function public.fieldcraft_cancel_reminder(p_delivery_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reminder_deliveries as delivery set
    status = 'Cancelled', claimed_until = null,
    updated_at = statement_timestamp()
  where delivery.id = p_delivery_id and delivery.status = 'Claimed'
$$;
revoke execute on function public.fieldcraft_cancel_reminder(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_cancel_reminder(uuid) to service_role;

create function public.fieldcraft_release_reminder(p_delivery_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.reminder_deliveries as delivery set
    status = 'Pending', claimed_until = null,
    updated_at = statement_timestamp()
  where delivery.id = p_delivery_id and delivery.status = 'Claimed'
$$;
revoke execute on function public.fieldcraft_release_reminder(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_release_reminder(uuid) to service_role;

create function public.fieldcraft_apply_reminder_event(
  p_provider_event_id text, p_provider_message_id text,
  p_status text, p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.reminder_deliveries%rowtype;
  v_existing public.reminder_provider_event_receipts%rowtype;
  v_outcome text := 'applied';
begin
  if p_provider_event_id is null or char_length(p_provider_event_id) not between 1 and 255
    or p_provider_message_id is null or char_length(p_provider_message_id) not between 1 and 255
    or p_status not in ('Delivered', 'Bounced') or p_occurred_at is null
  then raise exception 'invalid reminder event' using errcode = '22023'; end if;
  select * into v_existing from public.reminder_provider_event_receipts as receipt
  where receipt.provider_event_id = p_provider_event_id;
  if found then return jsonb_build_object('outcome', 'duplicate'); end if;
  select * into v_delivery from public.reminder_deliveries as delivery
  where delivery.provider_message_id = p_provider_message_id for update;
  if not found then raise exception 'reminder delivery was not found' using errcode = '22023'; end if;
  if p_occurred_at < coalesce(v_delivery.provider_event_at, v_delivery.accepted_at) then
    v_outcome := 'stale';
  else
    update public.reminder_deliveries as delivery set
      status = p_status,
      delivered_at = case when p_status = 'Delivered' then p_occurred_at else delivery.delivered_at end,
      provider_event_at = p_occurred_at,
      updated_at = statement_timestamp()
    where delivery.id = v_delivery.id;
  end if;
  insert into public.reminder_provider_event_receipts(
    provider_event_id, delivery_id, outcome, occurred_at
  ) values (p_provider_event_id, v_delivery.id, v_outcome, p_occurred_at);
  return jsonb_build_object('outcome', v_outcome);
end
$$;
revoke execute on function public.fieldcraft_apply_reminder_event(
  text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.fieldcraft_apply_reminder_event(
  text, text, text, timestamptz
) to service_role;

commit;
