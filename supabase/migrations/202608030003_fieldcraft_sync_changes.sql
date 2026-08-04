create table public.sync_changes (
  change_id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in (
    'profile', 'client', 'job', 'invoice', 'expense', 'service', 'inventory'
  )),
  entity_id uuid not null,
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

  insert into public.sync_changes (
    user_id, entity, entity_id, version, payload, deleted, updated_at
  ) values (
    v_user_id,
    v_entity,
    (v_row ->> 'id')::uuid,
    (v_row ->> 'version')::bigint,
    case when tg_op = 'DELETE' then null else v_row end,
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
select user_id, 'invoice', id, version, to_jsonb(invoice), updated_at
from public.invoices as invoice
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
            'clients', (
              select jsonb_build_object('name', client.name)
              from public.clients as client
              where client.user_id = page.user_id
                and client.id = (page.payload ->> 'client_id')::uuid
            ),
            'jobs', (
              select jsonb_build_object(
                'title', job.title,
                'address', job.address,
                'description', job.description,
                'trade_type', job.trade_type
              )
              from public.jobs as job
              where job.user_id = page.user_id
                and job.id = nullif(page.payload ->> 'job_id', '')::uuid
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
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_entity_id is null then
    raise exception 'mutation and entity IDs are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then return v_response; end if;

  v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
  if (p_kind = 'create' and v_cloud is not null)
    or (p_kind in ('update', 'delete') and v_cloud is null)
  then
    v_response := jsonb_build_object(
      'status', 'conflict',
      'mutation_id', p_mutation_id,
      'entity', p_entity,
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
        'entity_id', p_entity_id,
        'base_version', p_base_version,
        'local_version', p_base_version,
        'local_payload', p_payload,
        'cloud_version', (v_cloud ->> 'version')::bigint,
        'cloud_payload', v_cloud
      );
      insert into public.mutation_receipts (user_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
      return v_response;
    when sqlstate '22023' then
      v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
      if p_kind not in ('update', 'delete') or v_cloud is not null then raise; end if;
      v_response := jsonb_build_object(
        'status', 'conflict',
        'mutation_id', p_mutation_id,
        'entity', p_entity,
        'entity_id', p_entity_id,
        'base_version', p_base_version,
        'local_version', p_base_version,
        'local_payload', case when p_kind = 'delete' then null else p_payload end,
        'cloud_version', 0,
        'cloud_payload', null
      );
      insert into public.mutation_receipts (user_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
      return v_response;
  end;
  v_response := v_response || jsonb_build_object(
    'mutation_id', p_mutation_id,
    'entity', p_entity,
    'kind', p_kind,
    'entity_id', p_entity_id
  );
  if v_response ->> 'status' = 'conflict' then
    v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
    v_response := v_response || jsonb_build_object(
      'cloud', v_cloud,
      'cloud_payload', v_cloud,
      'cloud_version', (v_cloud ->> 'version')::bigint
    );
  elsif p_kind <> 'delete' then
    v_cloud := public.fieldcraft_owned_entity(v_user_id, p_entity, p_entity_id);
    v_response := v_response || jsonb_build_object('cloud', v_cloud);
  end if;
  if p_kind = 'delete' and v_response ->> 'status' = 'applied' then
    v_response := v_response || jsonb_build_object('deleted_at', clock_timestamp());
  end if;
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
  v_client jsonb;
  v_job jsonb;
  v_invoice jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and object payload are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));
  select receipt.response into v_response
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
  if found then return v_response; end if;

  v_client_id := public.require_jsonb_uuid(p_payload #> '{client,id}', 'client.id');
  v_job_id := public.require_jsonb_uuid(p_payload #> '{job,id}', 'job.id');
  v_invoice_id := public.require_jsonb_uuid(p_payload #> '{invoice,id}', 'invoice.id');

  begin
    v_response := public.save_invoice_bundle_v1_internal(p_mutation_id, p_payload);
    v_response := v_response || jsonb_build_object(
      'mutation_id', p_mutation_id,
      'entity', 'invoice_bundle',
      'entity_ids', jsonb_build_object(
        'client', v_client_id,
        'job', v_job_id,
        'invoice', v_invoice_id
      ),
      'cloud_versions', jsonb_build_object(
        'client', (v_response #>> '{client,version}')::bigint,
        'job', (v_response #>> '{job,version}')::bigint,
        'invoice', (v_response #>> '{invoice,version}')::bigint
      )
    );
    update public.mutation_receipts as receipt
    set response = v_response
    where receipt.user_id = v_user_id and receipt.mutation_id = p_mutation_id;
    return v_response;
  exception when sqlstate '40001' then
    select to_jsonb(client) into v_client
    from public.clients as client
    where client.user_id = v_user_id and client.id = v_client_id;
    select to_jsonb(job) into v_job
    from public.jobs as job
    where job.user_id = v_user_id and job.id = v_job_id;
    select to_jsonb(invoice) into v_invoice
    from public.invoices as invoice
    where invoice.user_id = v_user_id and invoice.id = v_invoice_id;
    if v_client is null or v_job is null or v_invoice is null then
      raise exception 'invoice bundle relationship is no longer available' using errcode = '22023';
    end if;
    v_response := jsonb_build_object(
      'status', 'conflict',
      'mutation_id', p_mutation_id,
      'entity', 'invoice_bundle',
      'entity_ids', jsonb_build_object(
        'client', v_client_id,
        'job', v_job_id,
        'invoice', v_invoice_id
      ),
      'local_payload', p_payload,
      'cloud_payload', jsonb_build_object(
        'client', v_client,
        'job', v_job,
        'invoice', v_invoice
      ),
      'cloud_versions', jsonb_build_object(
        'client', (v_client ->> 'version')::bigint,
        'job', (v_job ->> 'version')::bigint,
        'invoice', (v_invoice ->> 'version')::bigint
      )
    );
    insert into public.mutation_receipts (user_id, mutation_id, response)
    values (v_user_id, p_mutation_id, v_response);
    return v_response;
  end;
end;
$$;

revoke execute on function public.save_invoice_bundle(uuid, jsonb) from public, anon;
grant execute on function public.save_invoice_bundle(uuid, jsonb) to authenticated;
