create table public.sync_changes (
  change_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
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
  )
);

create index sync_changes_user_cursor_idx
  on public.sync_changes (user_id, updated_at, change_id);
create index sync_changes_user_mutation_idx
  on public.sync_changes (user_id, mutation_id, entity, entity_id)
  where mutation_id is not null;

alter table public.sync_changes enable row level security;
revoke all on public.sync_changes from public, anon, authenticated;
revoke all on sequence public.sync_changes_change_id_seq from public, anon, authenticated;

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
  v_mutation_id uuid := nullif(current_setting('fieldcraft.mutation_id', true), '')::uuid;
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
  v_user_id := case
    when tg_table_name = 'profiles' then (v_row ->> 'id')::uuid
    else (v_row ->> 'user_id')::uuid
  end;
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

  insert into public.sync_changes (
    user_id, entity, entity_id, mutation_id, version, payload, deleted, updated_at
  ) values (
    v_user_id,
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

-- Seed the append-only feed with the current canonical state so an account that
-- predates this migration still receives a complete first hydration.
insert into public.sync_changes (user_id, entity, entity_id, version, payload, updated_at)
select id, 'profile', id, version, to_jsonb(profile), updated_at
from public.profiles as profile
union all
select user_id, 'client', id, version, to_jsonb(client), updated_at
from public.clients as client
union all
select user_id, 'job', id, version, to_jsonb(job), updated_at
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
  invoice.updated_at
from public.invoices as invoice
join public.clients as client
  on client.user_id = invoice.user_id and client.id = invoice.client_id
left join public.jobs as job
  on job.user_id = invoice.user_id and job.id = invoice.job_id
union all
select user_id, 'expense', id, version, to_jsonb(expense), updated_at
from public.expenses as expense
union all
select user_id, 'service', id, version, to_jsonb(service), updated_at
from public.services as service
union all
select user_id, 'inventory', id, version, to_jsonb(inventory), updated_at
from public.inventory_items as inventory;

create or replace function public.pull_sync_changes(
  p_cursor_updated_at timestamptz default null,
  p_cursor_change_id bigint default null,
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
  v_last_updated_at timestamptz;
  v_last_change_id bigint;
  v_has_more boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if (p_cursor_updated_at is null) <> (p_cursor_change_id is null) then
    raise exception 'both cursor fields must be null or non-null' using errcode = '22023';
  end if;
  if p_cursor_change_id is not null and p_cursor_change_id < 0 then
    raise exception 'cursor change ID must be non-negative' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'pull limit must be between 1 and 500' using errcode = '22023';
  end if;

  with page as materialized (
    select change.*
    from public.sync_changes as change
    where change.user_id = v_user_id
      and (
        p_cursor_updated_at is null
        or (change.updated_at, change.change_id) >
           (p_cursor_updated_at, p_cursor_change_id)
      )
    order by change.updated_at, change.change_id
    limit p_limit
  ), projected as (
    select
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
                  and (client_change.updated_at, client_change.change_id)
                      <= (page.updated_at, page.change_id)
                order by client_change.updated_at desc, client_change.change_id desc
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
                  and (job_change.updated_at, job_change.change_id)
                      <= (page.updated_at, page.change_id)
                order by job_change.updated_at desc, job_change.change_id desc
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
        'change_id', projected.change_id,
        'owner_id', projected.user_id,
        'entity', projected.entity,
        'entity_id', projected.entity_id,
        'version', projected.version,
        'payload', projected.payload,
        'deleted', projected.deleted,
        'updated_at', projected.updated_at
      ) order by projected.updated_at, projected.change_id
    ), '[]'::jsonb),
    max(projected.updated_at) filter (
      where projected.change_id = (select max(page.change_id) from page
        where page.updated_at = (select max(updated_at) from page))
    ),
    max(projected.change_id) filter (
      where projected.updated_at = (select max(updated_at) from page)
    )
  into v_changes, v_last_updated_at, v_last_change_id
  from projected;

  if v_last_updated_at is null then
    v_last_updated_at := coalesce(p_cursor_updated_at, '1970-01-01 00:00:00+00'::timestamptz);
    v_last_change_id := coalesce(p_cursor_change_id, 0);
  end if;

  select exists (
    select 1
    from public.sync_changes as change
    where change.user_id = v_user_id
      and (change.updated_at, change.change_id) > (v_last_updated_at, v_last_change_id)
  ) into v_has_more;

  return jsonb_build_object(
    'status', 'ok',
    'changes', v_changes,
    'cursor', jsonb_build_object(
      'updated_at', v_last_updated_at,
      'change_id', v_last_change_id
    ),
    'has_more', v_has_more
  );
end;
$$;

revoke execute on function public.pull_sync_changes(timestamptz, bigint, integer)
  from public, anon;
grant execute on function public.pull_sync_changes(timestamptz, bigint, integer)
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
  p_fallback_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated_at timestamptz;
  v_change_id bigint;
begin
  select change.updated_at, change.change_id
  into v_updated_at, v_change_id
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
  order by (change.mutation_id = p_mutation_id) desc, change.change_id
  limit 1;

  if v_change_id is not null then
    return jsonb_build_object(
      'updated_at', v_updated_at,
      'change_id', v_change_id,
      'source', 'sync_changes'
    );
  end if;
  if p_fallback_updated_at is null then
    raise exception 'receipt has no comparable immutable event position' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'updated_at', p_fallback_updated_at,
    'change_id', 0,
    'source', 'legacy_receipt'
  );
end;
$$;

revoke execute on function public.fieldcraft_receipt_sync_position(
  uuid, uuid, text, uuid, jsonb, boolean, timestamptz
) from public, anon, authenticated;

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
  v_position_updated_at timestamptz;
  v_fallback_updated_at timestamptz;
  v_stored_repair boolean := false;
  v_repair_from_feed boolean := false;
  v_subtotal_cents bigint;
  v_tax_basis_points integer;
  v_tax_cents bigint;
  v_total_cents bigint;
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
      v_cloud := public.fieldcraft_enrich_receipt_entity(p_user_id, p_entity, v_cloud);
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
      if p_entity <> 'invoice'
        or not (v_raw_cloud ?& array[
          'id', 'user_id', 'client_id', 'job_id', 'number', 'line_items',
          'subtotal_cents', 'tax_basis_points', 'tax_cents', 'total_cents',
          'payment_terms', 'status', 'version', 'created_at', 'updated_at'
        ])
        or v_raw_cloud ->> 'id' <> p_entity_id::text
        or v_raw_cloud ->> 'user_id' <> p_user_id::text
        or not public.is_valid_invoice_line_items(v_raw_cloud -> 'line_items')
        or nullif(v_raw_cloud ->> 'client_id', '') is null
        or nullif(v_raw_cloud ->> 'number', '') is null
        or char_length(v_raw_cloud ->> 'number') > 64
        or v_raw_cloud ->> 'payment_terms' is null
        or v_raw_cloud ->> 'payment_terms' not in ('Due on receipt', 'Net 14', 'Net 30')
        or v_raw_cloud ->> 'status' is null
        or v_raw_cloud ->> 'status' not in (
          'Draft', 'Sent', 'Viewed', 'Partially Paid', 'Paid'
        )
        or (
          v_raw_cloud ->> 'notes' is not null
          and char_length(v_raw_cloud ->> 'notes') > 4000
        )
        or nullif(v_raw_cloud ->> 'version', '') is null
        or nullif(v_raw_cloud ->> 'created_at', '') is null
        or nullif(v_raw_cloud ->> 'updated_at', '') is null
        or v_raw_cloud ? 'clients'
        or v_raw_cloud ? 'jobs'
      then
        raise exception 'stored legacy invoice receipt cannot be repaired safely'
          using errcode = '22023';
      end if;
      perform public.require_jsonb_uuid(to_jsonb(v_raw_cloud ->> 'id'), 'receipt invoice id');
      perform public.require_jsonb_uuid(
        to_jsonb(v_raw_cloud ->> 'client_id'), 'receipt invoice client_id'
      );
      if nullif(v_raw_cloud ->> 'job_id', '') is not null then
        perform public.require_jsonb_uuid(
          to_jsonb(v_raw_cloud ->> 'job_id'), 'receipt invoice job_id'
        );
      end if;
      if (v_raw_cloud ->> 'version')::bigint < 1 then
        raise exception 'stored legacy invoice receipt version is invalid' using errcode = '22023';
      end if;
      v_subtotal_cents := public.invoice_subtotal_cents(v_raw_cloud -> 'line_items');
      v_tax_basis_points := public.require_jsonb_integer(
        v_raw_cloud -> 'tax_basis_points', 'receipt invoice tax_basis_points', 0, 10000
      )::integer;
      v_tax_cents := round(
        (v_subtotal_cents::numeric * v_tax_basis_points::numeric) / 10000
      )::bigint;
      v_total_cents := v_subtotal_cents + v_tax_cents;
      if public.require_jsonb_integer(
          v_raw_cloud -> 'subtotal_cents', 'receipt invoice subtotal_cents', 0, 100000000
        ) <> v_subtotal_cents
        or public.require_jsonb_integer(
          v_raw_cloud -> 'tax_cents', 'receipt invoice tax_cents', 0, 100000000
        ) <> v_tax_cents
        or public.require_jsonb_integer(
          v_raw_cloud -> 'total_cents', 'receipt invoice total_cents', 0, 100000000
        ) <> v_total_cents
        or v_total_cents > 100000000
      then
        raise exception 'stored legacy invoice receipt totals are invalid' using errcode = '22023';
      end if;
      perform (v_raw_cloud ->> 'created_at')::timestamptz;
      perform (v_raw_cloud ->> 'updated_at')::timestamptz;
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
  if v_stored_repair then
    v_position := p_response -> 'sync_position';
    if v_position is null
      or jsonb_typeof(v_position) <> 'object'
      or not (v_position ?& array['source', 'change_id', 'updated_at'])
      or jsonb_typeof(v_position -> 'source') <> 'string'
      or v_position ->> 'source' is distinct from 'legacy_receipt'
      or jsonb_typeof(v_position -> 'updated_at') <> 'string'
    then
      raise exception 'stored legacy feed repair position is invalid' using errcode = '22023';
    end if;
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
      v_fallback_updated_at
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

  if v_status = 'applied' then
    v_positions := jsonb_build_object(
      'client', public.fieldcraft_receipt_sync_position(
        p_user_id, p_mutation_id, 'client', v_client_id, v_client, false,
        coalesce(nullif(v_client ->> 'updated_at', '')::timestamptz, p_receipt_created_at)
      ),
      'job', public.fieldcraft_receipt_sync_position(
        p_user_id, p_mutation_id, 'job', v_job_id, v_job, false,
        coalesce(nullif(v_job ->> 'updated_at', '')::timestamptz, p_receipt_created_at)
      ),
      'invoice', public.fieldcraft_receipt_sync_position(
        p_user_id, p_mutation_id, 'invoice', v_invoice_id, v_invoice, false,
        coalesce(nullif(v_invoice ->> 'updated_at', '')::timestamptz, p_receipt_created_at)
      )
    );
    if p_response ? 'sync_positions' and p_response -> 'sync_positions' <> v_positions then
      raise exception 'stored bundle receipt positions do not match immutable history'
        using errcode = '22023';
    end if;
    p_response := p_response || jsonb_build_object('sync_positions', v_positions);
  end if;

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
    insert into public.mutation_receipts (user_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
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
        insert into public.mutation_receipts (user_id, mutation_id, response)
        values (v_user_id, p_mutation_id, v_response);
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
