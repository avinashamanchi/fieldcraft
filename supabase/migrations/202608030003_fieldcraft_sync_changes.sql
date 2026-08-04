-- Each owner's change_seq is the synchronization authority. It is allocated
-- while the owner's writer row is locked, in the same transaction as the
-- canonical write, so rollback cannot leave a cursor hole and commit order
-- cannot differ from feed order for that owner. change_id remains event
-- identity/diagnostic metadata only.
lock table public.profiles, public.clients, public.jobs, public.invoices,
  public.expenses, public.services, public.inventory_items
  in share row exclusive mode;

create table public.sync_owner_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_change_seq bigint not null default 0
    check (last_change_seq between 0 and 9007199254740991),
  writer_xid xid8,
  writer_mutation_id uuid
);

alter table public.sync_owner_counters enable row level security;
revoke all on public.sync_owner_counters from public, anon, authenticated;

create table public.sync_changes (
  change_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  change_seq bigint not null check (change_seq between 1 and 9007199254740991),
  entity text not null check (entity in (
    'profile', 'client', 'job', 'invoice', 'expense', 'service', 'inventory'
  )),
  entity_id uuid not null,
  mutation_id uuid,
  version bigint not null check (version >= 0),
  payload jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (deleted and payload is null)
    or (not deleted and jsonb_typeof(payload) = 'object')
  ),
  unique (user_id, change_seq)
);

create index sync_changes_user_cursor_idx
  on public.sync_changes (user_id, change_seq);
create index sync_changes_user_mutation_idx
  on public.sync_changes (user_id, mutation_id, entity, entity_id)
  where mutation_id is not null;

alter table public.sync_changes enable row level security;
revoke all on public.sync_changes from public, anon, authenticated;
revoke all on sequence public.sync_changes_change_id_seq from public, anon, authenticated;

create or replace function public.fieldcraft_lock_sync_owner(
  p_user_id uuid,
  p_mutation_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_last_change_seq bigint;
begin
  if p_user_id is null then
    raise exception 'synchronization owner is required' using errcode = '22023';
  end if;
  insert into public.sync_owner_counters (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select counter.last_change_seq
  into v_last_change_seq
  from public.sync_owner_counters as counter
  where counter.user_id = p_user_id
  for update;

  update public.sync_owner_counters as counter
  set writer_xid = pg_current_xact_id(),
      writer_mutation_id = p_mutation_id
  where counter.user_id = p_user_id;
  return v_last_change_seq;
end;
$$;

revoke execute on function public.fieldcraft_lock_sync_owner(uuid, uuid)
  from public, anon, authenticated;

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
    when 'expenses' then 'expense'
    when 'services' then 'service'
    when 'inventory_items' then 'inventory'
    else null
  end;
  if v_entity is null then
    raise exception 'unsupported synchronization source table' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and (
    (to_jsonb(old) ->> 'id') is distinct from (to_jsonb(new) ->> 'id')
    or case
      when tg_table_name = 'profiles'
        then to_jsonb(old) ->> 'id'
      else to_jsonb(old) ->> 'user_id'
    end is distinct from case
      when tg_table_name = 'profiles'
        then to_jsonb(new) ->> 'id'
      else to_jsonb(new) ->> 'user_id'
    end
  ) then
    raise exception 'synchronized entity and owner identities are immutable'
      using errcode = '22023';
  end if;
  v_user_id := case
    when tg_table_name = 'profiles' then (v_row ->> 'id')::uuid
    else (v_row ->> 'user_id')::uuid
  end;
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
      using errcode = '55000', detail = format(
        'writer_xid=%s current_xid=%s',
        (select counter.writer_xid::text from public.sync_owner_counters as counter
          where counter.user_id = v_user_id),
        pg_current_xact_id()::text
      );
  end if;

  insert into public.sync_changes (
    user_id, change_seq, entity, entity_id, mutation_id, version, payload, deleted, updated_at
  ) values (
    v_user_id,
    v_change_seq,
    v_entity,
    (v_row ->> 'id')::uuid,
    v_mutation_id,
    (v_row ->> 'version')::bigint,
    v_payload,
    tg_op = 'DELETE',
    v_updated_at
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.capture_sync_change() from public, anon, authenticated;

create trigger profiles_capture_sync_change
after insert or update or delete on public.profiles
for each row execute function public.capture_sync_change();
create trigger clients_capture_sync_change
after insert or update or delete on public.clients
for each row execute function public.capture_sync_change();
create trigger jobs_capture_sync_change
after insert or update or delete on public.jobs
for each row execute function public.capture_sync_change();
create trigger invoices_capture_sync_change
after insert or update or delete on public.invoices
for each row execute function public.capture_sync_change();
create trigger expenses_capture_sync_change
after insert or update or delete on public.expenses
for each row execute function public.capture_sync_change();
create trigger services_capture_sync_change
after insert or update or delete on public.services
for each row execute function public.capture_sync_change();
create trigger inventory_items_capture_sync_change
after insert or update or delete on public.inventory_items
for each row execute function public.capture_sync_change();

-- Seed the append-only feed with deterministic, contiguous per-owner
-- sequences so an account that predates this migration receives a complete
-- first hydration.
with seed as (
  select id as user_id, 'profile'::text as entity, id as entity_id,
    version, to_jsonb(profile) as payload, updated_at, 1 as entity_sort
  from public.profiles as profile
  union all
  select user_id, 'client', id, version, to_jsonb(client), updated_at, 2
  from public.clients as client
  union all
  select user_id, 'job', id, version, to_jsonb(job), updated_at, 3
  from public.jobs as job
  union all
  select invoice.user_id, 'invoice', invoice.id, invoice.version,
    to_jsonb(invoice) || jsonb_build_object(
      'clients', jsonb_build_object('name', client.name),
      'jobs', case when job.id is null then null else jsonb_build_object(
        'title', job.title,
        'address', job.address,
        'description', job.description,
        'trade_type', job.trade_type
      ) end
    ),
    invoice.updated_at, 4
  from public.invoices as invoice
  join public.clients as client
    on client.user_id = invoice.user_id and client.id = invoice.client_id
  left join public.jobs as job
    on job.user_id = invoice.user_id and job.id = invoice.job_id
  union all
  select user_id, 'expense', id, version, to_jsonb(expense), updated_at, 5
  from public.expenses as expense
  union all
  select user_id, 'service', id, version, to_jsonb(service), updated_at, 6
  from public.services as service
  union all
  select user_id, 'inventory', id, version, to_jsonb(inventory), updated_at, 7
  from public.inventory_items as inventory
), ranked as (
  select seed.*,
    row_number() over (
      partition by seed.user_id
      order by seed.updated_at, seed.entity_sort, seed.entity_id
    )::bigint as change_seq
  from seed
)
insert into public.sync_changes (
  user_id, change_seq, entity, entity_id, version, payload, updated_at
)
select user_id, change_seq, entity, entity_id, version, payload, updated_at
from ranked
order by user_id, change_seq;

insert into public.sync_owner_counters (user_id, last_change_seq)
select users.id, coalesce(max(change.change_seq), 0)
from auth.users as users
left join public.sync_changes as change on change.user_id = users.id
group by users.id;

create or replace function public.pull_sync_changes(
  p_cursor_change_seq bigint default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_changes jsonb;
  v_cursor_change_seq bigint := coalesce(p_cursor_change_seq, 0);
  v_head_change_seq bigint;
  v_first_change_seq bigint;
  v_last_updated_at timestamptz;
  v_last_change_seq bigint;
  v_last_change_id bigint;
  v_page_count bigint;
  v_has_more boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_cursor_change_seq < 0 then
    raise exception 'cursor change sequence must be non-negative' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'pull limit must be between 1 and 500' using errcode = '22023';
  end if;

  select counter.last_change_seq
  into v_head_change_seq
  from public.sync_owner_counters as counter
  where counter.user_id = v_user_id;
  v_head_change_seq := coalesce(v_head_change_seq, 0);
  if v_cursor_change_seq > v_head_change_seq then
    raise exception 'cursor change sequence is beyond the committed owner head'
      using errcode = '22023';
  end if;

  with page as materialized (
    select change.*
    from public.sync_changes as change
    where change.user_id = v_user_id
      and change.change_seq > v_cursor_change_seq
      and change.change_seq <= v_head_change_seq
    order by change.change_seq
    limit p_limit
  ), projected as (
    select
      page.change_seq,
      page.change_id,
      page.user_id,
      page.entity,
      page.entity_id,
      page.version,
      page.deleted,
      page.updated_at,
      case
        when page.deleted then null
        when page.entity = 'invoice' then
          page.payload || jsonb_build_object(
            'clients', coalesce(
              page.payload -> 'clients',
              (
                select jsonb_build_object('name', client_change.payload ->> 'name')
                from public.sync_changes as client_change
                where client_change.user_id = page.user_id
                  and client_change.entity = 'client'
                  and client_change.entity_id = (page.payload ->> 'client_id')::uuid
                  and not client_change.deleted
                  and client_change.change_seq <= page.change_seq
                order by client_change.change_seq desc
                limit 1
              )
            ),
            'jobs', coalesce(
              page.payload -> 'jobs',
              (
                select jsonb_build_object(
                  'title', job_change.payload ->> 'title',
                  'address', job_change.payload ->> 'address',
                  'description', job_change.payload ->> 'description',
                  'trade_type', job_change.payload ->> 'trade_type'
                )
                from public.sync_changes as job_change
                where job_change.user_id = page.user_id
                  and job_change.entity = 'job'
                  and job_change.entity_id = nullif(page.payload ->> 'job_id', '')::uuid
                  and not job_change.deleted
                  and job_change.change_seq <= page.change_seq
                order by job_change.change_seq desc
                limit 1
              )
            )
          )
        else page.payload
      end as payload
    from page
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'change_seq', projected.change_seq,
        'change_id', projected.change_id,
        'owner_id', projected.user_id,
        'entity', projected.entity,
        'entity_id', projected.entity_id,
        'version', projected.version,
        'payload', projected.payload,
        'deleted', projected.deleted,
        'updated_at', projected.updated_at
      ) order by projected.change_seq
    ), '[]'::jsonb),
    min(projected.change_seq),
    max(projected.change_seq),
    count(*)
  into v_changes, v_first_change_seq, v_last_change_seq, v_page_count
  from projected;

  if v_page_count > 0 and (
    v_first_change_seq <> v_cursor_change_seq + 1
    or v_last_change_seq - v_first_change_seq + 1 <> v_page_count
  ) then
    raise exception 'owner synchronization history is not contiguous'
      using errcode = '55000';
  end if;
  v_last_change_seq := coalesce(v_last_change_seq, v_cursor_change_seq);
  select change.updated_at, change.change_id
  into v_last_updated_at, v_last_change_id
  from public.sync_changes as change
  where change.user_id = v_user_id and change.change_seq = v_last_change_seq;
  v_last_updated_at := coalesce(
    v_last_updated_at,
    '1970-01-01 00:00:00+00'::timestamptz
  );
  v_last_change_id := coalesce(v_last_change_id, 0);
  v_has_more := v_last_change_seq < v_head_change_seq;

  return jsonb_build_object(
    'status', 'ok',
    'changes', v_changes,
    'cursor', jsonb_build_object(
      'updated_at', v_last_updated_at,
      'change_seq', v_last_change_seq,
      'change_id', v_last_change_id
    ),
    'has_more', v_has_more
  );
end;
$$;

revoke execute on function public.pull_sync_changes(bigint, integer)
  from public, anon;
grant execute on function public.pull_sync_changes(bigint, integer)
  to authenticated;

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
    when 'profile' then
      select to_jsonb(profile) into v_cloud from public.profiles as profile
      where profile.id = p_user_id and profile.id = p_entity_id;
    when 'client' then
      select to_jsonb(client) into v_cloud from public.clients as client
      where client.user_id = p_user_id and client.id = p_entity_id;
    when 'job' then
      select to_jsonb(job) into v_cloud from public.jobs as job
      where job.user_id = p_user_id and job.id = p_entity_id;
    when 'invoice' then
      select to_jsonb(invoice) || jsonb_build_object(
        'clients', jsonb_build_object('name', client.name),
        'jobs', case when job.id is null then null else jsonb_build_object(
          'title', job.title,
          'address', job.address,
          'description', job.description,
          'trade_type', job.trade_type
        ) end
      )
      into v_cloud
      from public.invoices as invoice
      join public.clients as client
        on client.user_id = invoice.user_id and client.id = invoice.client_id
      left join public.jobs as job
        on job.user_id = invoice.user_id and job.id = invoice.job_id
      where invoice.user_id = p_user_id and invoice.id = p_entity_id;
    when 'expense' then
      select to_jsonb(expense) into v_cloud from public.expenses as expense
      where expense.user_id = p_user_id and expense.id = p_entity_id;
    when 'service' then
      select to_jsonb(service) into v_cloud from public.services as service
      where service.user_id = p_user_id and service.id = p_entity_id;
    when 'inventory' then
      select to_jsonb(inventory) into v_cloud from public.inventory_items as inventory
      where inventory.user_id = p_user_id and inventory.id = p_entity_id;
    else
      raise exception 'unsupported entity' using errcode = '22023';
  end case;
  return v_cloud;
end;
$$;

revoke execute on function public.fieldcraft_owned_entity(uuid, text, uuid)
  from public, anon, authenticated;

create or replace function public.fieldcraft_enrich_receipt_entity(
  p_user_id uuid,
  p_entity text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_payload is null then return null; end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'receipt cloud payload must be an object' using errcode = '22023';
  end if;
  if p_entity <> 'invoice' then return p_payload; end if;
  if p_payload ->> 'user_id' <> p_user_id::text then
    raise exception 'receipt invoice owner does not match the replay owner' using errcode = '22023';
  end if;

  perform public.require_jsonb_uuid(to_jsonb(p_payload ->> 'id'), 'receipt invoice id');
  perform public.require_jsonb_uuid(to_jsonb(p_payload ->> 'client_id'), 'receipt invoice client_id');
  if p_payload ? 'clients' or p_payload ? 'jobs' then
    if not (p_payload ? 'clients' and p_payload ? 'jobs')
      or jsonb_typeof(p_payload -> 'clients') <> 'object'
      or nullif(btrim(p_payload #>> '{clients,name}'), '') is null
      or (
        nullif(p_payload ->> 'job_id', '') is not null
        and (
          jsonb_typeof(p_payload -> 'jobs') <> 'object'
          or nullif(btrim(p_payload #>> '{jobs,title}'), '') is null
          or nullif(btrim(p_payload #>> '{jobs,trade_type}'), '') is null
        )
      )
    then
      raise exception 'receipt invoice relationship snapshot is malformed'
        using errcode = '22023';
    end if;
  else
    raise exception 'receipt invoice relationship snapshot is unavailable'
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'clients') <> 'object'
    or nullif(btrim(p_payload #>> '{clients,name}'), '') is null
  then
    raise exception 'receipt invoice client snapshot is unavailable' using errcode = '22023';
  end if;
  if nullif(p_payload ->> 'job_id', '') is not null then
    perform public.require_jsonb_uuid(to_jsonb(p_payload ->> 'job_id'), 'receipt invoice job_id');
    if jsonb_typeof(p_payload -> 'jobs') <> 'object'
      or nullif(btrim(p_payload #>> '{jobs,title}'), '') is null
      or nullif(btrim(p_payload #>> '{jobs,trade_type}'), '') is null
    then
      raise exception 'receipt invoice job snapshot is unavailable' using errcode = '22023';
    end if;
  end if;
  return p_payload;
end;
$$;

revoke execute on function public.fieldcraft_enrich_receipt_entity(uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.fieldcraft_receipt_sync_position(
  p_user_id uuid,
  p_mutation_id uuid,
  p_entity text,
  p_entity_id uuid,
  p_payload jsonb,
  p_deleted boolean,
  p_fallback_updated_at timestamptz,
  p_snapshot_fallback boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated_at timestamptz;
  v_change_seq bigint;
  v_change_id bigint;
begin
  select change.updated_at, change.change_seq, change.change_id
  into v_updated_at, v_change_seq, v_change_id
  from public.sync_changes as change
  where change.user_id = p_user_id
    and change.entity = p_entity
    and change.entity_id = p_entity_id
    and change.deleted = p_deleted
    and (
      change.mutation_id = p_mutation_id
      or (
        not p_deleted
        and not change.deleted
        and p_payload is not null
        and case when p_entity = 'invoice'
          then change.payload - 'clients' - 'jobs'
          else change.payload
        end = case when p_entity = 'invoice'
          then p_payload - 'clients' - 'jobs'
          else p_payload
        end
      )
    )
  order by (change.mutation_id = p_mutation_id) desc, change.change_seq desc
  limit 1;

  if v_change_id is not null then
    return jsonb_build_object(
      'updated_at', v_updated_at,
      'change_seq', v_change_seq,
      'change_id', v_change_id,
      'source', 'sync_changes'
    );
  end if;
  if p_fallback_updated_at is null then
    raise exception 'receipt has no comparable immutable event position' using errcode = '22023';
  end if;
  if p_snapshot_fallback then
    select counter.last_change_seq
    into v_change_seq
    from public.sync_owner_counters as counter
    where counter.user_id = p_user_id;
    return jsonb_build_object(
      'updated_at', p_fallback_updated_at,
      'change_seq', coalesce(v_change_seq, 0),
      'change_id', 0,
      'source', 'sync_snapshot'
    );
  end if;
  return jsonb_build_object(
    'updated_at', p_fallback_updated_at,
    'change_seq', 0,
    'change_id', 0,
    'source', 'legacy_receipt'
  );
end;
$$;

revoke execute on function public.fieldcraft_receipt_sync_position(
  uuid, uuid, text, uuid, jsonb, boolean, timestamptz, boolean
) from public, anon, authenticated;

create or replace function public.fieldcraft_require_legacy_invoice_receipt(
  p_payload jsonb,
  p_user_id uuid,
  p_entity_id uuid
)
returns void
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_subtotal_cents bigint;
  v_tax_basis_points integer;
  v_tax_cents bigint;
  v_total_cents bigint;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or not (p_payload ?& array[
      'id', 'user_id', 'client_id', 'job_id', 'number', 'line_items',
      'subtotal_cents', 'tax_basis_points', 'tax_cents', 'total_cents',
      'payment_terms', 'status', 'version', 'created_at', 'updated_at'
    ])
    or p_payload ->> 'id' is distinct from p_entity_id::text
    or p_payload ->> 'user_id' is distinct from p_user_id::text
    or not public.is_valid_invoice_line_items(p_payload -> 'line_items')
    or nullif(p_payload ->> 'client_id', '') is null
    or nullif(p_payload ->> 'number', '') is null
    or char_length(p_payload ->> 'number') > 64
    or p_payload ->> 'payment_terms' is null
    or p_payload ->> 'payment_terms' not in ('Due on receipt', 'Net 14', 'Net 30')
    or p_payload ->> 'status' is null
    or p_payload ->> 'status' not in (
      'Draft', 'Sent', 'Viewed', 'Partially Paid', 'Paid'
    )
    or (
      p_payload ->> 'notes' is not null
      and char_length(p_payload ->> 'notes') > 4000
    )
    or nullif(p_payload ->> 'version', '') is null
    or nullif(p_payload ->> 'created_at', '') is null
    or nullif(p_payload ->> 'updated_at', '') is null
    or p_payload ? 'clients'
    or p_payload ? 'jobs'
  then
    raise exception 'stored legacy invoice receipt cannot be repaired safely'
      using errcode = '22023';
  end if;

  perform public.require_jsonb_uuid(to_jsonb(p_payload ->> 'id'), 'receipt invoice id');
  perform public.require_jsonb_uuid(
    to_jsonb(p_payload ->> 'client_id'), 'receipt invoice client_id'
  );
  if nullif(p_payload ->> 'job_id', '') is not null then
    perform public.require_jsonb_uuid(
      to_jsonb(p_payload ->> 'job_id'), 'receipt invoice job_id'
    );
  end if;
  perform public.require_jsonb_integer(
    p_payload -> 'version', 'stored legacy invoice receipt version',
    1, 9223372036854775807
  );
  v_subtotal_cents := public.invoice_subtotal_cents(p_payload -> 'line_items');
  v_tax_basis_points := public.require_jsonb_integer(
    p_payload -> 'tax_basis_points', 'receipt invoice tax_basis_points', 0, 10000
  )::integer;
  v_tax_cents := round(
    (v_subtotal_cents::numeric * v_tax_basis_points::numeric) / 10000
  )::bigint;
  v_total_cents := v_subtotal_cents + v_tax_cents;
  if public.require_jsonb_integer(
      p_payload -> 'subtotal_cents', 'receipt invoice subtotal_cents', 0, 100000000
    ) <> v_subtotal_cents
    or public.require_jsonb_integer(
      p_payload -> 'tax_cents', 'receipt invoice tax_cents', 0, 100000000
    ) <> v_tax_cents
    or public.require_jsonb_integer(
      p_payload -> 'total_cents', 'receipt invoice total_cents', 0, 100000000
    ) <> v_total_cents
    or v_total_cents > 100000000
  then
    raise exception 'stored legacy invoice receipt totals are invalid' using errcode = '22023';
  end if;
  perform (p_payload ->> 'created_at')::timestamptz;
  perform (p_payload ->> 'updated_at')::timestamptz;
end;
$$;

revoke execute on function public.fieldcraft_require_legacy_invoice_receipt(jsonb, uuid, uuid)
  from public, anon, authenticated;

create or replace function public.fieldcraft_bind_generic_receipt(
  p_user_id uuid,
  p_response jsonb,
  p_receipt_created_at timestamptz,
  p_mutation_id uuid,
  p_entity text,
  p_kind text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_cloud jsonb;
  v_raw_cloud jsonb;
  v_mutation_cloud jsonb;
  v_position_cloud jsonb;
  v_position jsonb;
  v_position_source text;
  v_position_change_seq bigint;
  v_position_updated_at timestamptz;
  v_head_change_seq bigint;
  v_fallback_updated_at timestamptz;
  v_stored_repair boolean := false;
  v_repair_from_feed boolean := false;
begin
  if p_response is null or jsonb_typeof(p_response) <> 'object' then
    raise exception 'stored mutation receipt is invalid' using errcode = '22023';
  end if;
  v_status := p_response ->> 'status';
  if v_status is null or v_status not in ('applied', 'conflict') then
    raise exception 'stored mutation receipt status is invalid' using errcode = '22023';
  end if;
  if (p_response ? 'mutation_id' and p_response ->> 'mutation_id' <> p_mutation_id::text)
    or (p_response ? 'entity' and p_response ->> 'entity' <> p_entity)
    or (p_response ? 'kind' and p_response ->> 'kind' <> p_kind)
    or (p_response ? 'entity_id' and p_response ->> 'entity_id' <> p_entity_id::text)
  then
    raise exception 'mutation receipt identity does not match the replay contract'
      using errcode = '22023';
  end if;
  if p_response ? 'repair_from_feed' then
    if p_response -> 'repair_from_feed' <> 'true'::jsonb then
      raise exception 'stored legacy feed repair marker is invalid' using errcode = '22023';
    end if;
    v_stored_repair := true;
  end if;

  v_raw_cloud := case
    when v_stored_repair then p_response -> 'legacy_cloud'
    else p_response -> 'cloud'
  end;
  p_response := (p_response - 'repair_from_feed' - 'legacy_cloud') || jsonb_build_object(
    'mutation_id', p_mutation_id,
    'entity', p_entity,
    'kind', p_kind,
    'entity_id', p_entity_id
  );
  if v_status = 'conflict' then
    if not (p_response ? 'cloud_payload' or p_response ? 'cloud') then
      raise exception 'conflict receipt cloud payload is missing' using errcode = '22023';
    end if;
    v_cloud := coalesce(p_response -> 'cloud_payload', p_response -> 'cloud');
    if v_cloud is not null and v_cloud <> 'null'::jsonb then
      if v_cloud ->> 'id' <> p_entity_id::text then
        raise exception 'conflict receipt cloud identity does not match the entity'
          using errcode = '22023';
      end if;
      if p_entity = 'invoice'
        and not (v_cloud ? 'clients')
        and not (v_cloud ? 'jobs')
      then
        perform public.fieldcraft_require_legacy_invoice_receipt(
          v_cloud, p_user_id, p_entity_id
        );
        if public.require_jsonb_integer(
            p_response -> 'cloud_version', 'conflict receipt cloud_version',
            1, 9223372036854775807
          ) <> public.require_jsonb_integer(
            v_cloud -> 'version', 'conflict receipt cloud payload version',
            1, 9223372036854775807
          )
        then
          raise exception 'conflict receipt cloud version does not match its payload'
            using errcode = '22023';
        end if;
        -- A pre-feed conflict has no historical relationship snapshots. Rebind
        -- the whole conflict to the current canonical invoice (or absence)
        -- instead of mixing historical invoice fields with current relations.
        v_cloud := public.fieldcraft_owned_entity(p_user_id, p_entity, p_entity_id);
      else
        v_cloud := public.fieldcraft_enrich_receipt_entity(p_user_id, p_entity, v_cloud);
      end if;
    else
      v_cloud := null;
    end if;
    p_response := p_response || jsonb_build_object(
      'cloud', v_cloud,
      'cloud_payload', v_cloud,
      'cloud_version', coalesce((v_cloud ->> 'version')::bigint, 0)
    );
  elsif p_kind = 'delete' then
    p_response := p_response || jsonb_build_object(
      'deleted_at', coalesce(
        nullif(p_response ->> 'deleted_at', '')::timestamptz,
        p_receipt_created_at
      )
    );
  else
    v_cloud := v_raw_cloud;
    if v_cloud is null or jsonb_typeof(v_cloud) <> 'object'
      or v_cloud ->> 'id' <> p_entity_id::text
    then
      raise exception 'applied receipt cloud identity does not match the entity'
        using errcode = '22023';
    end if;
    v_repair_from_feed := v_stored_repair;
    if not v_repair_from_feed then
      if p_entity = 'invoice'
        and not (v_raw_cloud ? 'clients')
        and not (v_raw_cloud ? 'jobs')
        and v_raw_cloud ->> 'user_id' = p_user_id::text
      then
        select change.payload
        into v_mutation_cloud
        from public.sync_changes as change
        where change.user_id = p_user_id
          and change.mutation_id = p_mutation_id
          and change.entity = p_entity
          and change.entity_id = p_entity_id
          and not change.deleted
        order by change.change_id
        limit 1;

        if found then
          if jsonb_typeof(v_mutation_cloud) <> 'object'
            or v_mutation_cloud - 'clients' - 'jobs' <> v_raw_cloud
          then
            raise exception 'mutation feed payload does not match the stored invoice receipt'
              using errcode = '22023';
          end if;
          v_cloud := public.fieldcraft_enrich_receipt_entity(
            p_user_id, p_entity, v_mutation_cloud
          );
        else
          v_repair_from_feed := true;
        end if;
      else
        v_cloud := public.fieldcraft_enrich_receipt_entity(p_user_id, p_entity, v_cloud);
      end if;
    end if;
    if v_repair_from_feed then
      if p_entity <> 'invoice' then
        raise exception 'stored legacy feed repair is only valid for invoices'
          using errcode = '22023';
      end if;
      perform public.fieldcraft_require_legacy_invoice_receipt(
        v_raw_cloud, p_user_id, p_entity_id
      );
      p_response := p_response || jsonb_build_object(
        'cloud', null,
        'legacy_cloud', v_raw_cloud,
        'repair_from_feed', true
      );
      v_position_cloud := v_raw_cloud;
    else
      p_response := p_response || jsonb_build_object('cloud', v_cloud);
      v_position_cloud := v_cloud;
    end if;
  end if;
  v_cloud := case
    when v_status = 'conflict' then p_response -> 'cloud_payload'
    when p_kind = 'delete' then null
    else p_response -> 'cloud'
  end;
  if not v_repair_from_feed then v_position_cloud := v_cloud; end if;
  v_fallback_updated_at := case
    when p_kind = 'delete' or v_position_cloud is null or v_position_cloud = 'null'::jsonb
      then p_receipt_created_at
    else nullif(v_position_cloud ->> 'updated_at', '')::timestamptz
  end;
  if v_status = 'conflict'
    and p_response ? 'sync_position'
    and p_response #>> '{sync_position,source}' = 'sync_snapshot'
  then
    v_position := p_response -> 'sync_position';
    if jsonb_typeof(v_position) <> 'object'
      or not (v_position ?& array['source', 'change_seq', 'change_id', 'updated_at'])
      or jsonb_typeof(v_position -> 'updated_at') <> 'string'
    then
      raise exception 'stored conflict snapshot position is invalid' using errcode = '22023';
    end if;
    v_position_change_seq := public.require_jsonb_integer(
      v_position -> 'change_seq',
      'stored conflict snapshot change_seq',
      0,
      9007199254740991
    );
    perform public.require_jsonb_integer(
      v_position -> 'change_id', 'stored conflict snapshot change_id', 0, 0
    );
    begin
      v_position_updated_at := (v_position ->> 'updated_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'stored conflict snapshot position is invalid' using errcode = '22023';
    end;
    select counter.last_change_seq into v_head_change_seq
    from public.sync_owner_counters as counter
    where counter.user_id = p_user_id;
    if v_position_change_seq > coalesce(v_head_change_seq, 0)
      or v_position_updated_at is distinct from v_fallback_updated_at
      or not (
        v_status = 'conflict'
        and (v_position_cloud is null or v_position_cloud = 'null'::jsonb)
      )
    then
      raise exception 'stored conflict snapshot position is invalid' using errcode = '22023';
    end if;
  elsif v_stored_repair then
    v_position := p_response -> 'sync_position';
    if v_position is null
      or jsonb_typeof(v_position) <> 'object'
      or not (v_position ?& array['source', 'change_seq', 'change_id', 'updated_at'])
      or jsonb_typeof(v_position -> 'source') <> 'string'
      or v_position ->> 'source' is distinct from 'legacy_receipt'
      or jsonb_typeof(v_position -> 'updated_at') <> 'string'
    then
      raise exception 'stored legacy feed repair position is invalid' using errcode = '22023';
    end if;
    perform public.require_jsonb_integer(
      v_position -> 'change_seq', 'stored legacy feed repair change_seq', 0, 0
    );
    perform public.require_jsonb_integer(
      v_position -> 'change_id', 'stored legacy feed repair change_id', 0, 0
    );
    begin
      v_position_updated_at := (v_position ->> 'updated_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'stored legacy feed repair position is invalid' using errcode = '22023';
    end;
    if v_position_updated_at is distinct from v_fallback_updated_at then
      raise exception 'stored legacy feed repair position is invalid' using errcode = '22023';
    end if;
  elsif v_repair_from_feed then
    v_position := jsonb_build_object(
      'updated_at', v_fallback_updated_at,
      'change_seq', 0,
      'change_id', 0,
      'source', 'legacy_receipt'
    );
  else
    v_position := public.fieldcraft_receipt_sync_position(
      p_user_id,
      p_mutation_id,
      p_entity,
      p_entity_id,
      v_position_cloud,
      p_kind = 'delete' or (
        v_status = 'conflict'
        and (v_position_cloud is null or v_position_cloud = 'null'::jsonb)
      ),
      v_fallback_updated_at,
      v_status = 'conflict'
        and (v_position_cloud is null or v_position_cloud = 'null'::jsonb)
    );
  end if;
  if v_status = 'applied' and p_kind = 'delete' then
    p_response := p_response || jsonb_build_object(
      'deleted_at', v_position -> 'updated_at'
    );
  end if;
  if p_response ? 'sync_position' and p_response -> 'sync_position' <> v_position then
    raise exception 'stored mutation receipt position does not match immutable history'
      using errcode = '22023';
  end if;
  p_response := p_response || jsonb_build_object('sync_position', v_position);
  return p_response;
end;
$$;

revoke execute on function public.fieldcraft_bind_generic_receipt(
  uuid, jsonb, timestamptz, uuid, text, text, uuid
) from public, anon, authenticated;

create or replace function public.fieldcraft_bind_bundle_receipt(
  p_user_id uuid,
  p_response jsonb,
  p_receipt_created_at timestamptz,
  p_mutation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_client_id uuid := public.require_jsonb_uuid(p_payload #> '{client,id}', 'client.id');
  v_job_id uuid := public.require_jsonb_uuid(p_payload #> '{job,id}', 'job.id');
  v_invoice_id uuid := public.require_jsonb_uuid(p_payload #> '{invoice,id}', 'invoice.id');
  v_cloud jsonb;
  v_client jsonb;
  v_job jsonb;
  v_invoice jsonb;
  v_positions jsonb;
  v_stored_positions jsonb;
  v_stored_position jsonb;
  v_position_change_seq bigint;
  v_position_updated_at timestamptz;
  v_head_change_seq bigint;
  v_entity text;
  v_member jsonb;
begin
  if public.require_jsonb_uuid(p_payload #> '{job,clientId}', 'job.clientId') <> v_client_id
    or public.require_jsonb_uuid(p_payload #> '{invoice,clientId}', 'invoice.clientId') <> v_client_id
    or public.require_jsonb_uuid(p_payload #> '{invoice,jobId}', 'invoice.jobId') <> v_job_id
  then
    raise exception 'bundle relationships do not match the supplied IDs'
      using errcode = '22023';
  end if;
  if p_response is null or jsonb_typeof(p_response) <> 'object' then
    raise exception 'stored bundle receipt is invalid' using errcode = '22023';
  end if;
  v_status := p_response ->> 'status';
  if v_status is null or v_status not in ('applied', 'conflict') then
    raise exception 'stored bundle receipt status is invalid' using errcode = '22023';
  end if;
  if (p_response ? 'mutation_id' and p_response ->> 'mutation_id' <> p_mutation_id::text)
    or (p_response ? 'entity' and p_response ->> 'entity' <> 'invoice_bundle')
    or (p_response #>> '{entity_ids,client}' is not null and p_response #>> '{entity_ids,client}' <> v_client_id::text)
    or (p_response #>> '{entity_ids,job}' is not null and p_response #>> '{entity_ids,job}' <> v_job_id::text)
    or (p_response #>> '{entity_ids,invoice}' is not null and p_response #>> '{entity_ids,invoice}' <> v_invoice_id::text)
  then
    raise exception 'bundle receipt identity does not match the replay contract'
      using errcode = '22023';
  end if;

  if v_status = 'applied' then
    v_client := p_response -> 'client';
    v_job := p_response -> 'job';
    v_invoice := p_response -> 'invoice';
    if v_client is null or jsonb_typeof(v_client) <> 'object'
      or v_job is null or jsonb_typeof(v_job) <> 'object'
      or v_invoice is null or jsonb_typeof(v_invoice) <> 'object'
    then
      raise exception 'applied bundle receipt must contain every cloud member'
        using errcode = '22023';
    end if;
  else
    v_cloud := p_response -> 'cloud_payload';
    if v_cloud is null or jsonb_typeof(v_cloud) <> 'object'
      or not (v_cloud ? 'client' and v_cloud ? 'job' and v_cloud ? 'invoice')
    then
      raise exception 'bundle conflict receipt cloud payload is invalid' using errcode = '22023';
    end if;
    v_client := v_cloud -> 'client';
    v_job := v_cloud -> 'job';
    v_invoice := v_cloud -> 'invoice';
  end if;
  if (v_client is not null and v_client <> 'null'::jsonb and v_client ->> 'id' <> v_client_id::text)
    or (v_job is not null and v_job <> 'null'::jsonb and (
      v_job ->> 'id' <> v_job_id::text or v_job ->> 'client_id' <> v_client_id::text
    ))
    or (v_invoice is not null and v_invoice <> 'null'::jsonb and (
      v_invoice ->> 'id' <> v_invoice_id::text
      or v_invoice ->> 'client_id' <> v_client_id::text
      or v_invoice ->> 'job_id' <> v_job_id::text
    ))
    or (v_job is not null and v_job <> 'null'::jsonb and (v_client is null or v_client = 'null'::jsonb))
    or (v_invoice is not null and v_invoice <> 'null'::jsonb and (
      v_client is null or v_client = 'null'::jsonb or v_job is null or v_job = 'null'::jsonb
    ))
  then
    raise exception 'bundle receipt relationships do not match the replay contract'
      using errcode = '22023';
  end if;

  v_positions := jsonb_build_object(
    'client', public.fieldcraft_receipt_sync_position(
      p_user_id, p_mutation_id, 'client', v_client_id, v_client,
      v_client is null or v_client = 'null'::jsonb,
      coalesce(nullif(v_client ->> 'updated_at', '')::timestamptz, p_receipt_created_at),
      v_status = 'conflict' and (v_client is null or v_client = 'null'::jsonb)
    ),
    'job', public.fieldcraft_receipt_sync_position(
      p_user_id, p_mutation_id, 'job', v_job_id, v_job,
      v_job is null or v_job = 'null'::jsonb,
      coalesce(nullif(v_job ->> 'updated_at', '')::timestamptz, p_receipt_created_at),
      v_status = 'conflict' and (v_job is null or v_job = 'null'::jsonb)
    ),
    'invoice', public.fieldcraft_receipt_sync_position(
      p_user_id, p_mutation_id, 'invoice', v_invoice_id, v_invoice,
      v_invoice is null or v_invoice = 'null'::jsonb,
      coalesce(nullif(v_invoice ->> 'updated_at', '')::timestamptz, p_receipt_created_at),
      v_status = 'conflict' and (v_invoice is null or v_invoice = 'null'::jsonb)
    )
  );
  if p_response ? 'sync_positions' then
    v_stored_positions := p_response -> 'sync_positions';
    if jsonb_typeof(v_stored_positions) <> 'object'
      or not (v_stored_positions ?& array['client', 'job', 'invoice'])
    then
      raise exception 'stored bundle receipt positions are invalid' using errcode = '22023';
    end if;
    foreach v_entity in array array['client', 'job', 'invoice'] loop
      v_stored_position := v_stored_positions -> v_entity;
      v_member := case v_entity
        when 'client' then v_client
        when 'job' then v_job
        else v_invoice
      end;
      if v_stored_position ->> 'source' = 'sync_snapshot' then
        if v_status <> 'conflict'
          or (v_member is not null and v_member <> 'null'::jsonb)
          or jsonb_typeof(v_stored_position) <> 'object'
          or not (v_stored_position ?& array['source', 'change_seq', 'change_id', 'updated_at'])
        then
          raise exception 'stored bundle snapshot position is invalid' using errcode = '22023';
        end if;
        v_position_change_seq := public.require_jsonb_integer(
          v_stored_position -> 'change_seq',
          'stored bundle snapshot change_seq',
          0,
          9007199254740991
        );
        perform public.require_jsonb_integer(
          v_stored_position -> 'change_id', 'stored bundle snapshot change_id', 0, 0
        );
        begin
          v_position_updated_at := (v_stored_position ->> 'updated_at')::timestamptz;
        exception when invalid_datetime_format or datetime_field_overflow then
          raise exception 'stored bundle snapshot position is invalid' using errcode = '22023';
        end;
        select counter.last_change_seq into v_head_change_seq
        from public.sync_owner_counters as counter
        where counter.user_id = p_user_id;
        if v_position_change_seq > coalesce(v_head_change_seq, 0) then
          raise exception 'stored bundle snapshot position is invalid' using errcode = '22023';
        end if;
        v_positions := jsonb_set(v_positions, array[v_entity], v_stored_position);
      end if;
    end loop;
    if v_stored_positions <> v_positions then
      raise exception 'stored bundle receipt positions do not match immutable history'
        using errcode = '22023';
    end if;
  end if;
  p_response := p_response || jsonb_build_object('sync_positions', v_positions);

  return p_response || jsonb_build_object(
    'mutation_id', p_mutation_id,
    'entity', 'invoice_bundle',
    'entity_ids', jsonb_build_object(
      'client', v_client_id,
      'job', v_job_id,
      'invoice', v_invoice_id
    ),
    'cloud_versions', jsonb_build_object(
      'client', coalesce((v_client ->> 'version')::bigint, 0),
      'job', coalesce((v_job ->> 'version')::bigint, 0),
      'invoice', coalesce((v_invoice ->> 'version')::bigint, 0)
    )
  );
end;
$$;

revoke execute on function public.fieldcraft_bind_bundle_receipt(
  uuid, jsonb, timestamptz, uuid, jsonb
)
  from public, anon, authenticated;

create or replace function public.fieldcraft_bundle_conflict_receipt(
  p_user_id uuid,
  p_mutation_id uuid,
  p_payload jsonb,
  p_client jsonb,
  p_job jsonb,
  p_invoice jsonb
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.fieldcraft_bind_bundle_receipt(
    p_user_id,
    jsonb_build_object(
      'status', 'conflict',
      'local_payload', p_payload,
      'cloud_payload', jsonb_build_object(
        'client', p_client,
        'job', p_job,
        'invoice', p_invoice
      )
    ),
    clock_timestamp(),
    p_mutation_id,
    p_payload
  )
$$;

revoke execute on function public.fieldcraft_bundle_conflict_receipt(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;

alter function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb)
  rename to apply_entity_mutation_v1_internal;

revoke execute on function public.apply_entity_mutation_v1_internal(uuid, text, text, uuid, bigint, jsonb)
  from public, anon, authenticated;

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
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_response jsonb;
  v_cloud jsonb;
  v_receipt_created_at timestamptz;
  v_previous_mutation_id text;
  v_handled_conflict boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_entity_id is null then
    raise exception 'mutation and entity IDs are required' using errcode = '22023';
  end if;
  if p_entity not in ('profile', 'client', 'job', 'invoice', 'expense', 'service', 'inventory') then
    raise exception 'unsupported entity: %', p_entity using errcode = '22023';
  end if;
  if p_kind not in ('create', 'update', 'delete') then
    raise exception 'unsupported mutation kind: %', p_kind using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be an object' using errcode = '22023';
  end if;

  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response, receipt.created_at into v_response, v_receipt_created_at
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    v_response := public.fieldcraft_bind_generic_receipt(
      v_user_id,
      v_response,
      v_receipt_created_at,
      p_mutation_id,
      p_entity,
      p_kind,
      p_entity_id
    );
    update public.mutation_receipts as receipt
    set response = v_response
    where receipt.user_id = v_user_id
      and receipt.mutation_id = p_mutation_id
      and receipt.response is distinct from v_response;
    return v_response;
  end if;

  v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
  if (p_kind = 'create' and v_cloud is not null)
    or (p_kind in ('update', 'delete') and v_cloud is null)
  then
    v_response := jsonb_build_object(
      'status', 'conflict',
      'mutation_id', p_mutation_id,
      'entity', p_entity,
      'kind', p_kind,
      'entity_id', p_entity_id,
      'base_version', p_base_version,
      'local_version', p_base_version,
      'local_payload', case when p_kind = 'delete' then null else p_payload end,
      'cloud_version', coalesce((v_cloud ->> 'version')::bigint, 0),
      'cloud_payload', v_cloud
    );
    v_receipt_created_at := statement_timestamp();
    v_response := public.fieldcraft_bind_generic_receipt(
      v_user_id, v_response, v_receipt_created_at, p_mutation_id,
      p_entity, p_kind, p_entity_id
    );
    insert into public.mutation_receipts (
      user_id, mutation_id, response, created_at, updated_at
    ) values (
      v_user_id, p_mutation_id, v_response,
      v_receipt_created_at, v_receipt_created_at
    );
    return v_response;
  end if;

  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    begin
      v_response := public.apply_entity_mutation_v1_internal(
        p_mutation_id, p_entity, p_kind, p_entity_id, p_base_version, p_payload
      );
    exception
      when unique_violation then
        v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
        if p_kind <> 'create' or v_cloud is null then raise; end if;
        v_response := jsonb_build_object(
          'status', 'conflict',
          'mutation_id', p_mutation_id,
          'entity', p_entity,
          'kind', p_kind,
          'entity_id', p_entity_id,
          'base_version', p_base_version,
          'local_version', p_base_version,
          'local_payload', p_payload,
          'cloud_version', (v_cloud ->> 'version')::bigint,
          'cloud_payload', v_cloud
        );
        v_receipt_created_at := statement_timestamp();
        v_response := public.fieldcraft_bind_generic_receipt(
          v_user_id, v_response, v_receipt_created_at, p_mutation_id,
          p_entity, p_kind, p_entity_id
        );
        insert into public.mutation_receipts (
          user_id, mutation_id, response, created_at, updated_at
        ) values (
          v_user_id, p_mutation_id, v_response,
          v_receipt_created_at, v_receipt_created_at
        );
        v_handled_conflict := true;
      when sqlstate '22023' then
        v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
        if p_kind not in ('update', 'delete') or v_cloud is not null then raise; end if;
        v_response := jsonb_build_object(
          'status', 'conflict',
          'mutation_id', p_mutation_id,
          'entity', p_entity,
          'kind', p_kind,
          'entity_id', p_entity_id,
          'base_version', p_base_version,
          'local_version', p_base_version,
          'local_payload', case when p_kind = 'delete' then null else p_payload end,
          'cloud_version', 0,
          'cloud_payload', null
        );
        v_receipt_created_at := statement_timestamp();
        v_response := public.fieldcraft_bind_generic_receipt(
          v_user_id, v_response, v_receipt_created_at, p_mutation_id,
          p_entity, p_kind, p_entity_id
        );
        insert into public.mutation_receipts (
          user_id, mutation_id, response, created_at, updated_at
        ) values (
          v_user_id, p_mutation_id, v_response,
          v_receipt_created_at, v_receipt_created_at
        );
        v_handled_conflict := true;
    end;
  exception when others then
    perform set_config(
      'fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true
    );
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  if v_handled_conflict then return v_response; end if;
  select receipt.created_at into v_receipt_created_at
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  v_response := public.fieldcraft_bind_generic_receipt(
    v_user_id,
    v_response,
    v_receipt_created_at,
    p_mutation_id,
    p_entity,
    p_kind,
    p_entity_id
  );
  update public.mutation_receipts as receipt
  set response = v_response
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  return v_response;
end;
$$;

revoke execute on function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb)
  from public, anon;
grant execute on function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb)
  to authenticated;

alter function public.save_invoice_bundle(uuid, jsonb)
  rename to save_invoice_bundle_v1_internal;

revoke execute on function public.save_invoice_bundle_v1_internal(uuid, jsonb)
  from public, anon, authenticated;

create function public.save_invoice_bundle(
  p_mutation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_response jsonb;
  v_client_id uuid;
  v_job_id uuid;
  v_invoice_id uuid;
  v_client_base bigint;
  v_job_base bigint;
  v_invoice_base bigint;
  v_client jsonb;
  v_job jsonb;
  v_invoice jsonb;
  v_receipt_created_at timestamptz;
  v_previous_mutation_id text;
  v_handled_conflict boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and object payload are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'client') <> 'object'
    or jsonb_typeof(p_payload -> 'job') <> 'object'
    or jsonb_typeof(p_payload -> 'invoice') <> 'object'
  then
    raise exception 'payload must contain client, job, and invoice objects'
      using errcode = '22023';
  end if;

  v_client_id := public.require_jsonb_uuid(p_payload #> '{client,id}', 'client.id');
  v_job_id := public.require_jsonb_uuid(p_payload #> '{job,id}', 'job.id');
  v_invoice_id := public.require_jsonb_uuid(p_payload #> '{invoice,id}', 'invoice.id');
  if public.require_jsonb_uuid(p_payload #> '{job,clientId}', 'job.clientId') <> v_client_id
    or public.require_jsonb_uuid(p_payload #> '{invoice,clientId}', 'invoice.clientId') <> v_client_id
    or public.require_jsonb_uuid(p_payload #> '{invoice,jobId}', 'invoice.jobId') <> v_job_id
  then
    raise exception 'bundle relationships do not match the supplied IDs'
      using errcode = '22023';
  end if;

  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response, receipt.created_at into v_response, v_receipt_created_at
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then
    v_response := public.fieldcraft_bind_bundle_receipt(
      v_user_id, v_response, v_receipt_created_at, p_mutation_id, p_payload
    );
    update public.mutation_receipts as receipt
    set response = v_response
    where receipt.user_id = v_user_id
      and receipt.mutation_id = p_mutation_id
      and receipt.response is distinct from v_response;
    return v_response;
  end if;

  v_client_base := case when (p_payload -> 'client') ? 'baseVersion' then
    public.require_jsonb_integer(
      p_payload #> '{client,baseVersion}', 'client.baseVersion', 0, 9223372036854775807
    ) else 0 end;
  v_job_base := case when (p_payload -> 'job') ? 'baseVersion' then
    public.require_jsonb_integer(
      p_payload #> '{job,baseVersion}', 'job.baseVersion', 0, 9223372036854775807
    ) else 0 end;
  v_invoice_base := case when (p_payload -> 'invoice') ? 'baseVersion' then
    public.require_jsonb_integer(
      p_payload #> '{invoice,baseVersion}', 'invoice.baseVersion', 0, 9223372036854775807
    ) else 0 end;

  select to_jsonb(client) into v_client
  from public.clients as client
  where client.user_id = v_user_id and client.id = v_client_id
  for update;
  select to_jsonb(job) into v_job
  from public.jobs as job
  where job.user_id = v_user_id and job.id = v_job_id
  for update;
  select to_jsonb(invoice) into v_invoice
  from public.invoices as invoice
  where invoice.user_id = v_user_id and invoice.id = v_invoice_id
  for update;

  if (v_client is null and v_client_base > 0)
    or (v_client is not null and (v_client_base = 0 or (v_client ->> 'version')::bigint <> v_client_base))
    or (v_job is null and v_job_base > 0)
    or (v_job is not null and (v_job_base = 0 or (v_job ->> 'version')::bigint <> v_job_base))
    or (v_invoice is null and v_invoice_base > 0)
    or (v_invoice is not null and (v_invoice_base = 0 or (v_invoice ->> 'version')::bigint <> v_invoice_base))
  then
    v_response := public.fieldcraft_bundle_conflict_receipt(
      v_user_id, p_mutation_id, p_payload, v_client, v_job, v_invoice
    );
    insert into public.mutation_receipts (user_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
    return v_response;
  end if;

  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    begin
      v_response := public.save_invoice_bundle_v1_internal(p_mutation_id, p_payload);
    exception when unique_violation or serialization_failure then
      select to_jsonb(client) into v_client
      from public.clients as client
      where client.user_id = v_user_id and client.id = v_client_id;
      select to_jsonb(job) into v_job
      from public.jobs as job
      where job.user_id = v_user_id and job.id = v_job_id;
      select to_jsonb(invoice) into v_invoice
      from public.invoices as invoice
      where invoice.user_id = v_user_id and invoice.id = v_invoice_id;
      v_response := public.fieldcraft_bundle_conflict_receipt(
        v_user_id, p_mutation_id, p_payload, v_client, v_job, v_invoice
      );
      insert into public.mutation_receipts (user_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
      v_handled_conflict := true;
    end;
  exception when others then
    perform set_config(
      'fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true
    );
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
  if v_handled_conflict then return v_response; end if;
  select receipt.created_at into v_receipt_created_at
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  v_response := public.fieldcraft_bind_bundle_receipt(
    v_user_id, v_response, v_receipt_created_at, p_mutation_id, p_payload
  );
  update public.mutation_receipts as receipt
  set response = v_response
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  return v_response;
end;
$$;

revoke execute on function public.save_invoice_bundle(uuid, jsonb) from public, anon;
grant execute on function public.save_invoice_bundle(uuid, jsonb) to authenticated;
