begin;

-- A deletion marker is written before any provider or account cleanup.  The
-- sync-owner lock checks it so a late device cannot recreate work while the
-- account deletion transaction is being coordinated outside Postgres.
create table public.fieldcraft_owner_deletion_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation bigint not null default 1 check (generation > 0),
  invalidated_at timestamptz not null default statement_timestamp()
);

alter table public.fieldcraft_owner_deletion_state enable row level security;
revoke all on public.fieldcraft_owner_deletion_state
  from public, anon, authenticated;
grant all on public.fieldcraft_owner_deletion_state to service_role;

create or replace function public.fieldcraft_lock_sync_owner(
  p_user_id uuid,
  p_mutation_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_change_seq bigint;
begin
  if p_user_id is null then
    raise exception 'synchronization owner is required' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.fieldcraft_owner_deletion_state as deletion
    where deletion.user_id = p_user_id
  ) then
    raise exception 'account deletion is in progress' using errcode = '42501';
  end if;
  insert into public.sync_owner_counters (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
  select counter.last_change_seq into v_last_change_seq
  from public.sync_owner_counters as counter
  where counter.user_id = p_user_id
  for update;
  update public.sync_owner_counters as counter
  set writer_xid = pg_current_xact_id(), writer_mutation_id = p_mutation_id
  where counter.user_id = p_user_id;
  return v_last_change_seq;
end
$$;
revoke execute on function public.fieldcraft_lock_sync_owner(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.fieldcraft_invalidate_owner_work(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_generation bigint;
begin
  if p_user_id is null then
    raise exception 'owner is required' using errcode = '22023';
  end if;
  select deletion.generation into v_generation
  from public.fieldcraft_owner_deletion_state as deletion
  where deletion.user_id = p_user_id;
  if found then
    return v_generation;
  end if;
  -- Acquire the canonical writer first, perform every database revocation in
  -- this transaction, then publish the deletion marker atomically at commit.
  perform public.fieldcraft_lock_sync_owner(p_user_id, null);
  update public.invoice_payment_links as link
  set revoked_at = coalesce(link.revoked_at, statement_timestamp())
  where link.user_id = p_user_id and link.revoked_at is null;
  update public.reminder_schedules as schedule
  set active = false, version = schedule.version + 1,
      updated_at = statement_timestamp()
  where schedule.user_id = p_user_id and schedule.active;
  update public.reminder_deliveries as delivery
  set status = 'Cancelled', claimed_until = null,
      updated_at = statement_timestamp()
  where delivery.user_id = p_user_id
    and delivery.status in ('Pending', 'Claimed');
  insert into public.fieldcraft_owner_deletion_state as deletion (
    user_id, generation, invalidated_at
  ) values (p_user_id, 1, statement_timestamp())
  on conflict (user_id) do update set
    generation = deletion.generation,
    invalidated_at = deletion.invalidated_at
  returning generation into v_generation;
  return v_generation;
end
$$;
revoke execute on function public.fieldcraft_invalidate_owner_work(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_invalidate_owner_work(uuid)
  to service_role;

create function public.fieldcraft_revoke_owner_payment_links(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_user_id is null then
    raise exception 'owner is required' using errcode = '22023';
  end if;
  update public.invoice_payment_links as link
  set revoked_at = coalesce(link.revoked_at, statement_timestamp())
  where link.user_id = p_user_id and link.revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.fieldcraft_revoke_owner_payment_links(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_revoke_owner_payment_links(uuid)
  to service_role;

create function public.fieldcraft_cancel_owner_reminders(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_user_id is null then
    raise exception 'owner is required' using errcode = '22023';
  end if;
  update public.reminder_schedules as schedule
  set active = false, version = schedule.version + 1,
      updated_at = statement_timestamp()
  where schedule.user_id = p_user_id and schedule.active;
  update public.reminder_deliveries as delivery
  set status = 'Cancelled', claimed_until = null,
      updated_at = statement_timestamp()
  where delivery.user_id = p_user_id
    and delivery.status in ('Pending', 'Claimed');
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function public.fieldcraft_cancel_owner_reminders(uuid)
  from public, anon, authenticated;
grant execute on function public.fieldcraft_cancel_owner_reminders(uuid)
  to service_role;

create or replace function public.fieldcraft_owner_has_pro(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select not exists (
    select 1 from public.fieldcraft_owner_deletion_state as deletion
    where deletion.user_id = p_user_id
  ) and coalesce(public.fieldcraft_entitlement_is_active(
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

create or replace function public.fieldcraft_require_pro()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.fieldcraft_owner_has_pro(v_user_id) then
    raise exception 'PRO_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('active', true);
end
$$;
revoke execute on function public.fieldcraft_require_pro()
  from public, anon, service_role;
grant execute on function public.fieldcraft_require_pro() to authenticated;

-- Operational rows contain no raw owner identity or business content.  The
-- caller may provide only a rotating HMAC digest and tightly bounded labels.
alter table public.fieldcraft_operational_events drop column user_id;
alter table public.fieldcraft_operational_events
  add column owner_digest text check (
    owner_digest is null or owner_digest ~ '^[0-9a-f]{64}$'
  ),
  add column digest_key_version integer check (
    digest_key_version is null or digest_key_version between 1 and 1000000
  );
alter table public.fieldcraft_operational_events
  add constraint fieldcraft_operational_event_digest_pair_check check (
    (owner_digest is null) = (digest_key_version is null)
  ),
  drop constraint fieldcraft_operational_events_dimensions_check,
  add constraint fieldcraft_operational_events_dimensions_check check (
    jsonb_typeof(dimensions) = 'object'
    and pg_column_size(dimensions) <= 2048
    and not dimensions ?| array[
      'email', 'ownerId', 'userId', 'invoice', 'payload', 'body', 'token',
      'authorization', 'customer', 'businessName', 'recipient'
    ]
    and dimensions - array[
      'requestId', 'route', 'deployment', 'provider', 'environment',
      'status', 'reason', 'latencyBucket'
    ]::text[] = '{}'::jsonb
  );

create function public.record_fieldcraft_operational_event(
  p_event_type text,
  p_outcome text,
  p_dimensions jsonb,
  p_owner_digest text default null,
  p_digest_key_version integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fieldcraft_operational_events (
    event_type, outcome, dimensions, owner_digest, digest_key_version
  ) values (
    p_event_type, p_outcome, coalesce(p_dimensions, '{}'::jsonb),
    p_owner_digest, p_digest_key_version
  );
end
$$;
revoke execute on function public.record_fieldcraft_operational_event(
  text, text, jsonb, text, integer
) from public, anon, authenticated;
grant execute on function public.record_fieldcraft_operational_event(
  text, text, jsonb, text, integer
) to service_role;

create function public.prune_fieldcraft_release_receipts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operational integer;
  v_mutations integer;
  v_revenuecat integer;
  v_payments integer;
  v_reminders integer;
  v_links integer;
begin
  delete from public.fieldcraft_operational_events
  where occurred_at < statement_timestamp() - interval '30 days';
  get diagnostics v_operational = row_count;
  delete from public.mutation_receipts where retained_until < statement_timestamp();
  get diagnostics v_mutations = row_count;
  delete from public.revenuecat_event_receipts where retained_until < statement_timestamp();
  get diagnostics v_revenuecat = row_count;
  delete from public.payment_provider_event_receipts where retained_until < statement_timestamp();
  get diagnostics v_payments = row_count;
  delete from public.reminder_provider_event_receipts where retained_until < statement_timestamp();
  get diagnostics v_reminders = row_count;
  delete from public.invoice_payment_links
  where revoked_at is not null or expires_at < statement_timestamp();
  get diagnostics v_links = row_count;
  return jsonb_build_object(
    'operational', v_operational, 'mutations', v_mutations,
    'revenuecat', v_revenuecat, 'payments', v_payments,
    'reminders', v_reminders, 'links', v_links
  );
end
$$;
revoke execute on function public.prune_fieldcraft_release_receipts()
  from public, anon, authenticated;
grant execute on function public.prune_fieldcraft_release_receipts()
  to service_role;

commit;
