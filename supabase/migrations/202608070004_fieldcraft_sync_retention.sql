-- Bounded synchronization retention. Expired cursors recover through a paged
-- canonical snapshot; retained local writes are never part of server pruning.

create table public.sync_device_cursors (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  cursor_change_seq bigint not null check (
    cursor_change_seq between 0 and 9007199254740991
  ),
  last_seen_at timestamptz not null default statement_timestamp(),
  primary key (user_id, device_id)
);

create table public.sync_retention_watermarks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_available_change_seq bigint not null default 1 check (
    first_available_change_seq between 1 and 9007199254740991
  ),
  pruned_through_change_seq bigint not null default 0 check (
    pruned_through_change_seq between 0 and 9007199254740991
  ),
  updated_at timestamptz not null default statement_timestamp(),
  check (first_available_change_seq = pruned_through_change_seq + 1)
);

create table public.fieldcraft_operational_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'sync_pull', 'sync_reset', 'sync_failure', 'mutation_failure',
    'quarantine', 'provider_event', 'reminder_delivery', 'account_deletion'
  )),
  outcome text not null check (outcome in ('ok', 'rejected', 'failed', 'retry')),
  dimensions jsonb not null default '{}'::jsonb check (
    jsonb_typeof(dimensions) = 'object' and pg_column_size(dimensions) <= 2048
  ),
  occurred_at timestamptz not null default statement_timestamp()
);

create index sync_device_cursors_retention_idx
  on public.sync_device_cursors (user_id, last_seen_at, cursor_change_seq);
create index fieldcraft_operational_events_retention_idx
  on public.fieldcraft_operational_events (occurred_at, id);

alter table public.mutation_receipts
  add column retained_until timestamptz not null
  default (statement_timestamp() + interval '400 days');

alter table public.mutation_receipts
  add constraint mutation_receipts_minimum_retention_check
  check (retained_until >= created_at + interval '400 days');

create index mutation_receipts_retention_idx
  on public.mutation_receipts (retained_until);

alter table public.sync_device_cursors enable row level security;
alter table public.sync_retention_watermarks enable row level security;
alter table public.fieldcraft_operational_events enable row level security;

revoke all on table public.sync_device_cursors,
  public.sync_retention_watermarks, public.fieldcraft_operational_events
  from public, anon, authenticated;
revoke all on sequence public.fieldcraft_operational_events_id_seq
  from public, anon, authenticated;
grant all on table public.sync_device_cursors,
  public.sync_retention_watermarks, public.fieldcraft_operational_events
  to service_role;
grant usage, select on sequence public.fieldcraft_operational_events_id_seq
  to service_role;

create function public.record_fieldcraft_sync_device_cursor(
  p_device_id uuid,
  p_cursor_change_seq bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_head bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_device_id is null or p_cursor_change_seq is null or p_cursor_change_seq < 0 then
    raise exception 'invalid device cursor' using errcode = '22023';
  end if;
  select coalesce(counter.last_change_seq, 0) into v_head
  from public.sync_owner_counters as counter
  where counter.user_id = v_user_id;
  v_head := coalesce(v_head, 0);
  if p_cursor_change_seq > v_head then
    raise exception 'device cursor is beyond owner head' using errcode = '22023';
  end if;
  insert into public.sync_device_cursors (
    user_id, device_id, cursor_change_seq, last_seen_at
  ) values (
    v_user_id, p_device_id, p_cursor_change_seq, statement_timestamp()
  )
  on conflict (user_id, device_id) do update set
    cursor_change_seq = greatest(
      public.sync_device_cursors.cursor_change_seq,
      excluded.cursor_change_seq
    ),
    last_seen_at = excluded.last_seen_at;
end
$$;

revoke execute on function public.record_fieldcraft_sync_device_cursor(uuid, bigint)
  from public, anon, service_role;
grant execute on function public.record_fieldcraft_sync_device_cursor(uuid, bigint)
  to authenticated;

alter function public.pull_sync_changes(bigint, integer)
  rename to pull_sync_changes_retained_internal;
revoke execute on function public.pull_sync_changes_retained_internal(bigint, integer)
  from public, anon, authenticated, service_role;

create function public.pull_sync_changes(
  p_cursor_change_seq bigint default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cursor bigint := coalesce(p_cursor_change_seq, 0);
  v_head bigint;
  v_first_available bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_cursor < 0 then
    raise exception 'cursor change sequence must be non-negative' using errcode = '22023';
  end if;
  select coalesce(counter.last_change_seq, 0) into v_head
  from public.sync_owner_counters as counter
  where counter.user_id = v_user_id;
  v_head := coalesce(v_head, 0);
  if v_cursor > v_head then
    raise exception 'cursor change sequence is beyond the committed owner head'
      using errcode = '22023';
  end if;
  select watermark.first_available_change_seq into v_first_available
  from public.sync_retention_watermarks as watermark
  where watermark.user_id = v_user_id;
  if v_first_available is null then
    select coalesce(min(change.change_seq), case when v_head = 0 then 1 else v_head end)
    into v_first_available
    from public.sync_changes as change
    where change.user_id = v_user_id;
  end if;
  if v_cursor < v_first_available - 1 then
    return jsonb_build_object(
      'status', 'cursor_expired',
      'snapshot_watermark', v_head,
      'snapshot_cursor', null
    );
  end if;
  -- The retained implementation caps each page at its captured head using:
  -- change.change_seq <= v_head_change_seq
  return public.pull_sync_changes_retained_internal(p_cursor_change_seq, p_limit);
end
$$;

revoke execute on function public.pull_sync_changes(bigint, integer)
  from public, anon, service_role;
grant execute on function public.pull_sync_changes(bigint, integer)
  to authenticated;

create function public.pull_sync_snapshot(
  p_snapshot_watermark bigint,
  p_after_entity text default null,
  p_after_id text default null,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_head bigint;
  v_rows jsonb;
  v_page_count integer;
  v_last_entity text;
  v_last_id text;
  v_has_more boolean;
  v_resume_updated_at timestamptz;
  v_resume_change_id bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_snapshot_watermark is null or p_snapshot_watermark < 0 then
    raise exception 'invalid snapshot watermark' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'snapshot limit must be between 1 and 200' using errcode = '22023';
  end if;
  if (p_after_entity is null) <> (p_after_id is null) then
    raise exception 'snapshot cursor must be complete' using errcode = '22023';
  end if;
  select coalesce(counter.last_change_seq, 0) into v_head
  from public.sync_owner_counters as counter
  where counter.user_id = v_user_id;
  v_head := coalesce(v_head, 0);
  if p_snapshot_watermark > v_head then
    raise exception 'snapshot watermark is beyond owner head' using errcode = '22023';
  end if;

  with entities as materialized (
    select 'profile'::text as entity, profile.id, profile.version, profile.updated_at
      from public.profiles as profile where profile.id = v_user_id
    union all select 'client', client.id, client.version, client.updated_at
      from public.clients as client where client.user_id = v_user_id
    union all select 'job', job.id, job.version, job.updated_at
      from public.jobs as job where job.user_id = v_user_id
    union all select 'invoice', invoice.id, invoice.version, invoice.updated_at
      from public.invoices as invoice where invoice.user_id = v_user_id
    union all select 'estimate', estimate.id, estimate.version, estimate.updated_at
      from public.estimates as estimate where estimate.user_id = v_user_id
    union all select 'payment', payment.id, payment.version, payment.updated_at
      from public.payments as payment where payment.user_id = v_user_id
    union all select 'reminder_schedule', schedule.id, schedule.version, schedule.updated_at
      from public.reminder_schedules as schedule where schedule.user_id = v_user_id
    union all select 'expense', expense.id, expense.version, expense.updated_at
      from public.expenses as expense where expense.user_id = v_user_id
    union all select 'service', service.id, service.version, service.updated_at
      from public.services as service where service.user_id = v_user_id
    union all select 'inventory', inventory.id, inventory.version, inventory.updated_at
      from public.inventory_items as inventory where inventory.user_id = v_user_id
  ), page as materialized (
    select entity.entity, entity.id, entity.version, entity.updated_at
    from entities as entity
    where p_after_entity is null
       or (entity.entity, entity.id::text) > (p_after_entity, p_after_id)
    order by entity.entity, entity.id::text
    limit p_limit + 1
  ), bounded as materialized (
    select page.* from page
    order by page.entity, page.id::text
    limit p_limit
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'owner_id', v_user_id,
      'entity', bounded.entity,
      'entity_id', bounded.id,
      'version', bounded.version,
      'updated_at', bounded.updated_at,
      'payload', public.fieldcraft_owned_entity(v_user_id, bounded.entity, bounded.id)
    ) order by bounded.entity, bounded.id::text), '[]'::jsonb),
    count(*)::integer,
    (select bounded_cursor.entity from bounded as bounded_cursor
      order by bounded_cursor.entity desc, bounded_cursor.id::text desc limit 1),
    (select bounded_cursor.id::text from bounded as bounded_cursor
      order by bounded_cursor.entity desc, bounded_cursor.id::text desc limit 1),
    (select count(*) > p_limit from page)
  into v_rows, v_page_count, v_last_entity, v_last_id, v_has_more
  from bounded;

  if not v_has_more then
    v_last_entity := null;
    v_last_id := null;
  end if;
  select change.updated_at, change.change_id
  into v_resume_updated_at, v_resume_change_id
  from public.sync_changes as change
  where change.user_id = v_user_id
    and change.change_seq = p_snapshot_watermark;
  v_resume_updated_at := coalesce(v_resume_updated_at, '1970-01-01 00:00:00+00'::timestamptz);
  v_resume_change_id := coalesce(v_resume_change_id, 0);

  return jsonb_build_object(
    'status', 'ok',
    'rows', v_rows,
    'snapshot_watermark', p_snapshot_watermark,
    'cursor', case when v_has_more then jsonb_build_object(
      'entity', v_last_entity, 'id', v_last_id
    ) else null end,
    'has_more', v_has_more,
    'resume_cursor', jsonb_build_object(
      'updated_at', v_resume_updated_at,
      'change_seq', p_snapshot_watermark,
      'change_id', v_resume_change_id
    )
  );
end
$$;

revoke execute on function public.pull_sync_snapshot(bigint, text, text, integer)
  from public, anon, service_role;
grant execute on function public.pull_sync_snapshot(bigint, text, text, integer)
  to authenticated;

create function public.prune_fieldcraft_operational_data(
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner record;
  v_device_floor bigint;
  v_prunable_through bigint;
  v_deleted_changes bigint := 0;
  v_count bigint;
begin
  if p_now is null then raise exception 'prune time required' using errcode = '22023'; end if;

  delete from public.sync_device_cursors as device
  where device.last_seen_at < p_now - interval '90 days';

  for v_owner in
    select counter.user_id, counter.last_change_seq
    from public.sync_owner_counters as counter
  loop
    select min(device.cursor_change_seq) into v_device_floor
    from public.sync_device_cursors as device
    where device.user_id = v_owner.user_id;
    v_prunable_through := least(
      greatest(v_owner.last_change_seq - 1, 0),
      coalesce(v_device_floor, greatest(v_owner.last_change_seq - 1, 0))
    );
    with removed as (
      delete from public.sync_changes as change
      where change.user_id = v_owner.user_id
        and change.change_seq <= v_prunable_through
        and change.updated_at < p_now - interval '90 days'
      returning change.change_seq
    ) select count(*) into v_count from removed;
    v_deleted_changes := v_deleted_changes + v_count;
    insert into public.sync_retention_watermarks (
      user_id, first_available_change_seq, pruned_through_change_seq, updated_at
    ) values (
      v_owner.user_id,
      coalesce((select min(change.change_seq) from public.sync_changes as change
                where change.user_id = v_owner.user_id), v_owner.last_change_seq + 1),
      coalesce((select min(change.change_seq) - 1 from public.sync_changes as change
                where change.user_id = v_owner.user_id), v_owner.last_change_seq),
      p_now
    ) on conflict (user_id) do update set
      first_available_change_seq = excluded.first_available_change_seq,
      pruned_through_change_seq = excluded.pruned_through_change_seq,
      updated_at = excluded.updated_at;
  end loop;

  delete from public.mutation_receipts as receipt where receipt.retained_until < p_now;
  delete from public.revenuecat_event_receipts as receipt where receipt.retained_until < p_now;
  delete from public.feature_admissions as admission where admission.retained_until < p_now;
  delete from public.payment_provider_event_receipts as receipt where receipt.retained_until < p_now;
  delete from public.reminder_deliveries as delivery
    where delivery.created_at < p_now - interval '400 days';
  delete from public.fieldcraft_operational_events as event
    where event.occurred_at < p_now - interval '30 days';

  return jsonb_build_object('deleted_sync_changes', v_deleted_changes);
end
$$;

revoke execute on function public.prune_fieldcraft_operational_data(timestamptz)
  from public, anon, authenticated;
grant execute on function public.prune_fieldcraft_operational_data(timestamptz)
  to service_role;
