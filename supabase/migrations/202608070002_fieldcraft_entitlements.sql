do $$
begin
  if to_regprocedure('public.fieldcraft_require_aal2()') is null then
    raise exception 'migration 202608070001 must run before entitlements'
      using errcode = '55000';
  end if;
end
$$;

create table public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  entitlement text not null check (entitlement = 'pro'),
  product_id text not null check (
    product_id in ('fieldcraft_pro_monthly', 'fieldcraft_pro_annual')
  ),
  environment text not null check (environment in ('SANDBOX', 'PRODUCTION')),
  status text not null check (status in (
    'active', 'cancelled', 'billing_retry', 'grace_period',
    'expired', 'revoked', 'refunded'
  )),
  provider_active boolean not null,
  expires_at timestamptz not null,
  provider_event_at timestamptz not null,
  event_rank smallint not null check (event_rank between 1 and 4),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.revenuecat_event_receipts (
  provider text not null check (provider = 'revenuecat'),
  event_id_hash text not null check (
    length(event_id_hash) = 64 and event_id_hash ~ '^[0-9a-f]{64}$'
  ),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_event_at timestamptz not null,
  outcome text not null check (outcome in ('applied', 'stale')),
  created_at timestamptz not null default statement_timestamp(),
  retained_until timestamptz not null default (statement_timestamp() + interval '400 days'),
  primary key (provider, event_id_hash),
  check (retained_until >= created_at + interval '400 days')
);

create table public.feature_admissions (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  feature text not null check (feature in (
    'create-client', 'create-open-job', 'issue-document',
    'stripe-payment-link', 'scheduled-reminder', 'revenue-dashboard',
    'edit-existing-record', 'record-payment', 'export-account', 'delete-account'
  )),
  allowed boolean not null,
  reason text check (reason in ('FREE_LIMIT', 'PRO_REQUIRED', 'ENTITLEMENT_STALE')),
  limit_count integer check (limit_count between 0 and 1000000),
  created_at timestamptz not null default statement_timestamp(),
  retained_until timestamptz not null default (statement_timestamp() + interval '400 days'),
  used_at timestamptz,
  primary key (user_id, mutation_id, feature),
  check (
    (allowed and reason is null and limit_count is null)
    or (not allowed and reason is not null)
  ),
  check (retained_until >= created_at + interval '400 days')
);

create function public.fieldcraft_mark_invoice_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('Sent', 'Viewed', 'Partially Paid', 'Paid')
    and new.sent_at is null
  then
    new.sent_at := statement_timestamp();
  end if;
  return new;
end
$$;

revoke execute on function public.fieldcraft_mark_invoice_issued()
  from public, anon, authenticated, service_role;

create trigger invoices_mark_issued
before insert or update of status on public.invoices
for each row execute function public.fieldcraft_mark_invoice_issued();

create index subscription_entitlements_provider_event_idx
  on public.subscription_entitlements (provider_event_at desc, user_id);
create index revenuecat_event_receipts_retention_idx
  on public.revenuecat_event_receipts (retained_until);
create index feature_admissions_retention_idx
  on public.feature_admissions (retained_until);
create index invoices_user_issued_idx
  on public.invoices (user_id, (coalesce(sent_at, created_at)))
  where status in ('Sent', 'Viewed', 'Partially Paid', 'Paid');

alter table public.subscription_entitlements enable row level security;
alter table public.revenuecat_event_receipts enable row level security;
alter table public.feature_admissions enable row level security;

revoke all on table public.subscription_entitlements from public, anon, authenticated;
revoke all on table public.revenuecat_event_receipts from public, anon, authenticated;
revoke all on table public.feature_admissions from public, anon, authenticated;
grant all on table public.subscription_entitlements to service_role;
grant all on table public.revenuecat_event_receipts to service_role;
grant all on table public.feature_admissions to service_role;

create function public.fieldcraft_entitlement_is_active(
  p_status text,
  p_provider_active boolean,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_expires_at > p_now and (
    p_status in ('active', 'cancelled')
    or (p_status in ('billing_retry', 'grace_period') and p_provider_active)
  )
$$;

revoke execute on function public.fieldcraft_entitlement_is_active(
  text, boolean, timestamptz, timestamptz
) from public, anon, authenticated;

create function public.get_my_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.subscription_entitlements%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_row
  from public.subscription_entitlements as entitlement
  where entitlement.user_id = v_user_id;
  if not found or not public.fieldcraft_entitlement_is_active(
    v_row.status, v_row.provider_active, v_row.expires_at, statement_timestamp()
  ) then
    return jsonb_build_object('owner_id', v_user_id, 'state', 'free');
  end if;
  return jsonb_build_object(
    'owner_id', v_user_id,
    'state', 'pro',
    'product_id', v_row.product_id,
    'expires_at', v_row.expires_at
  );
end
$$;

revoke execute on function public.get_my_entitlement() from public, anon, service_role;
grant execute on function public.get_my_entitlement() to authenticated;

create function public.fieldcraft_event_rank(p_status text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status in ('refunded', 'revoked') then 4
    when p_status = 'expired' then 3
    when p_status in ('cancelled', 'billing_retry', 'grace_period') then 2
    when p_status = 'active' then 1
    else null
  end::smallint
$$;

revoke execute on function public.fieldcraft_event_rank(text)
  from public, anon, authenticated;

create function public.apply_revenuecat_event(
  p_event_id_hash text,
  p_user_id uuid,
  p_product_id text,
  p_environment text,
  p_status text,
  p_provider_active boolean,
  p_expires_at timestamptz,
  p_provider_event_at timestamptz,
  p_event_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.subscription_entitlements%rowtype;
  v_rank smallint := public.fieldcraft_event_rank(p_status);
  v_outcome text := 'applied';
  v_terminal boolean;
  v_qualifying_purchase boolean := p_event_type in (
    'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'
  );
begin
  if p_event_id_hash is null or length(p_event_id_hash) <> 64
    or p_event_id_hash !~ '^[0-9a-f]{64}$'
    or p_user_id is null
    or p_product_id not in ('fieldcraft_pro_monthly', 'fieldcraft_pro_annual')
    or p_environment not in ('SANDBOX', 'PRODUCTION')
    or v_rank is null
    or p_provider_active is null
    or p_expires_at is null
    or p_provider_event_at is null
    or p_event_type not in (
      'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE',
      'CANCELLATION', 'BILLING_ISSUE', 'SUBSCRIPTION_PAUSED',
      'EXPIRATION', 'REFUND', 'REVOKE'
    )
    or not (
      (p_event_type in (
        'INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE'
      ) and p_status = 'active' and p_provider_active)
      or (p_event_type = 'CANCELLATION'
        and p_status = 'cancelled' and p_provider_active)
      or (p_event_type = 'BILLING_ISSUE' and p_status = 'billing_retry')
      or (p_event_type = 'SUBSCRIPTION_PAUSED'
        and p_status = 'grace_period' and p_provider_active)
      or (p_event_type = 'EXPIRATION'
        and p_status = 'expired' and not p_provider_active)
      or (p_event_type = 'REFUND'
        and p_status = 'refunded' and not p_provider_active)
      or (p_event_type = 'REVOKE'
        and p_status = 'revoked' and not p_provider_active)
    )
  then
    raise exception 'invalid normalized RevenueCat event' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if exists (
    select 1 from public.revenuecat_event_receipts as receipt
    where receipt.provider = 'revenuecat'
      and receipt.event_id_hash = p_event_id_hash
  ) then
    return 'duplicate';
  end if;

  select * into v_current
  from public.subscription_entitlements as entitlement
  where entitlement.user_id = p_user_id
  for update;

  if found then
    v_terminal := v_current.status in ('refunded', 'revoked');
    if p_provider_event_at < v_current.provider_event_at
      or (
        p_provider_event_at = v_current.provider_event_at
        and v_rank <= v_current.event_rank
      )
      or (
        p_provider_event_at > v_current.provider_event_at
        and v_terminal
        and not v_qualifying_purchase
      )
    then
      v_outcome := 'stale';
    end if;
  end if;

  if v_outcome = 'applied' then
    insert into public.subscription_entitlements (
      user_id, entitlement, product_id, environment, status,
      provider_active, expires_at, provider_event_at, event_rank, updated_at
    ) values (
      p_user_id, 'pro', p_product_id, p_environment, p_status,
      p_provider_active, p_expires_at, p_provider_event_at, v_rank,
      statement_timestamp()
    )
    on conflict (user_id) do update set
      entitlement = excluded.entitlement,
      product_id = excluded.product_id,
      environment = excluded.environment,
      status = excluded.status,
      provider_active = excluded.provider_active,
      expires_at = excluded.expires_at,
      provider_event_at = excluded.provider_event_at,
      event_rank = excluded.event_rank,
      updated_at = statement_timestamp();
  end if;

  insert into public.revenuecat_event_receipts (
    provider, event_id_hash, user_id, provider_event_at, outcome
  ) values (
    'revenuecat', p_event_id_hash, p_user_id, p_provider_event_at, v_outcome
  );
  return v_outcome;
end
$$;

revoke execute on function public.apply_revenuecat_event(
  text, uuid, text, text, text, boolean, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_revenuecat_event(
  text, uuid, text, text, text, boolean, timestamptz, timestamptz, text
) to service_role;

create function public.reserve_feature_admission(
  p_mutation_id uuid,
  p_feature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.feature_admissions%rowtype;
  v_allowed boolean := false;
  v_reason text;
  v_limit integer;
  v_count bigint := 0;
  v_pro boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_feature not in (
    'create-client', 'create-open-job', 'issue-document',
    'stripe-payment-link', 'scheduled-reminder', 'revenue-dashboard',
    'edit-existing-record', 'record-payment', 'export-account', 'delete-account'
  ) then
    raise exception 'invalid feature admission request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));
  select * into v_existing
  from public.feature_admissions as admission
  where admission.user_id = v_user_id
    and admission.mutation_id = p_mutation_id
    and admission.feature = p_feature;
  if found then
    return jsonb_strip_nulls(jsonb_build_object(
      'owner_id', v_user_id,
      'mutation_id', p_mutation_id,
      'feature', p_feature,
      'allowed', v_existing.allowed,
      'reason', v_existing.reason,
      'limit', v_existing.limit_count
    ));
  end if;

  select public.fieldcraft_entitlement_is_active(
    entitlement.status,
    entitlement.provider_active,
    entitlement.expires_at,
    statement_timestamp()
  ) into v_pro
  from public.subscription_entitlements as entitlement
  where entitlement.user_id = v_user_id;
  v_pro := coalesce(v_pro, false);

  if p_feature in (
    'edit-existing-record', 'record-payment', 'export-account', 'delete-account'
  ) then
    v_allowed := true;
  elsif p_feature in (
    'stripe-payment-link', 'scheduled-reminder', 'revenue-dashboard'
  ) then
    v_allowed := v_pro;
    if not v_allowed then v_reason := 'PRO_REQUIRED'; end if;
  else
    if p_feature = 'create-client' then
      select count(*) into v_count from public.clients as client
      where client.user_id = v_user_id;
      v_limit := 10;
    elsif p_feature = 'create-open-job' then
      select count(*) into v_count from public.jobs as job
      where job.user_id = v_user_id
        and job.status in ('Scheduled', 'In Progress');
      v_limit := 3;
    else
      select count(*) into v_count from public.invoices as invoice
      where invoice.user_id = v_user_id
        and invoice.status in ('Sent', 'Viewed', 'Partially Paid', 'Paid')
        and coalesce(invoice.sent_at, invoice.created_at)
          >= statement_timestamp() - interval '30 days';
      v_limit := 5;
    end if;
    v_allowed := v_count < v_limit or v_pro;
    if not v_allowed then v_reason := 'FREE_LIMIT'; end if;
    if v_allowed then v_limit := null; end if;
  end if;

  insert into public.feature_admissions (
    user_id, mutation_id, feature, allowed, reason, limit_count
  ) values (
    v_user_id, p_mutation_id, p_feature, v_allowed, v_reason, v_limit
  );
  return jsonb_strip_nulls(jsonb_build_object(
    'owner_id', v_user_id,
    'mutation_id', p_mutation_id,
    'feature', p_feature,
    'allowed', v_allowed,
    'reason', v_reason,
    'limit', v_limit
  ));
end
$$;

revoke execute on function public.reserve_feature_admission(uuid, text)
  from public, anon, service_role;
grant execute on function public.reserve_feature_admission(uuid, text)
  to authenticated;

create function public.fieldcraft_consume_admission(
  p_user_id uuid,
  p_mutation_id uuid,
  p_feature text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admission public.feature_admissions%rowtype;
begin
  select * into v_admission
  from public.feature_admissions as admission
  where admission.user_id = p_user_id
    and admission.mutation_id = p_mutation_id
    and admission.feature = p_feature
  for update;
  if not found or not v_admission.allowed then
    raise exception 'matching feature admission required' using errcode = '42501';
  end if;
  if v_admission.used_at is not null then
    if exists (
      select 1 from public.mutation_receipts as receipt
      where receipt.user_id = p_user_id and receipt.mutation_id = p_mutation_id
    ) then
      return;
    end if;
    raise exception 'feature admission already consumed' using errcode = '42501';
  end if;
  update public.feature_admissions as admission
  set used_at = statement_timestamp()
  where admission.user_id = p_user_id
    and admission.mutation_id = p_mutation_id
    and admission.feature = p_feature;
end
$$;

revoke execute on function public.fieldcraft_consume_admission(uuid, uuid, text)
  from public, anon, authenticated, service_role;

alter function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb)
  rename to apply_entity_mutation_v2_internal;
revoke execute on function public.apply_entity_mutation_v2_internal(
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
  v_count bigint;
  v_existing_status text;
  v_requires_capacity boolean := false;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if p_kind = 'create' and p_entity = 'client' then
    select count(*) into v_count from public.clients as client
    where client.user_id = v_user_id;
    if v_count >= 10 then
      perform public.fieldcraft_consume_admission(
        v_user_id, p_mutation_id, 'create-client'
      );
    end if;
  elsif p_entity = 'job'
    and (
      (p_kind = 'create'
        and coalesce(p_payload ->> 'status', 'Scheduled') in ('Scheduled', 'In Progress'))
      or (p_kind = 'update' and p_payload ? 'status'
        and p_payload ->> 'status' in ('Scheduled', 'In Progress'))
    )
  then
    v_requires_capacity := p_kind = 'create';
    if p_kind = 'update' then
      select job.status into v_existing_status
      from public.jobs as job
      where job.user_id = v_user_id and job.id = p_entity_id;
      v_requires_capacity := found
        and v_existing_status not in ('Scheduled', 'In Progress');
    end if;
    if v_requires_capacity then
      select count(*) into v_count from public.jobs as job
      where job.user_id = v_user_id
        and job.status in ('Scheduled', 'In Progress');
      if v_count >= 3 then
        perform public.fieldcraft_consume_admission(
          v_user_id, p_mutation_id, 'create-open-job'
        );
      end if;
    end if;
  elsif p_entity = 'invoice'
    and (
      (p_kind = 'create' and coalesce(p_payload ->> 'status', 'Draft') in (
        'Sent', 'Viewed', 'Partially Paid', 'Paid'
      ))
      or (p_kind = 'update' and p_payload ? 'status' and p_payload ->> 'status' in (
        'Sent', 'Viewed', 'Partially Paid', 'Paid'
      ))
    )
  then
    v_requires_capacity := p_kind = 'create';
    if p_kind = 'update' then
      select invoice.status into v_existing_status
      from public.invoices as invoice
      where invoice.user_id = v_user_id and invoice.id = p_entity_id;
      v_requires_capacity := found
        and v_existing_status not in ('Sent', 'Viewed', 'Partially Paid', 'Paid');
    end if;
    if v_requires_capacity then
      select count(*) into v_count from public.invoices as invoice
      where invoice.user_id = v_user_id
        and invoice.status in ('Sent', 'Viewed', 'Partially Paid', 'Paid')
        and coalesce(invoice.sent_at, invoice.created_at)
          >= statement_timestamp() - interval '30 days';
      if v_count >= 5 then
        perform public.fieldcraft_consume_admission(
          v_user_id, p_mutation_id, 'issue-document'
        );
      end if;
    end if;
  end if;
  return public.apply_entity_mutation_v2_internal(
    p_mutation_id, p_entity, p_kind, p_entity_id, p_base_version, p_payload
  );
end
$$;

revoke execute on function public.apply_entity_mutation(
  uuid, text, text, uuid, bigint, jsonb
) from public, anon, service_role;
grant execute on function public.apply_entity_mutation(
  uuid, text, text, uuid, bigint, jsonb
) to authenticated;

alter function public.save_invoice_bundle(uuid, jsonb)
  rename to save_invoice_bundle_v2_internal;
revoke execute on function public.save_invoice_bundle_v2_internal(uuid, jsonb)
  from public, anon, authenticated, service_role;

create function public.save_invoice_bundle(
  p_mutation_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_job_id uuid;
  v_invoice_id uuid;
  v_count bigint;
  v_existing_job_status text;
  v_existing_invoice_status text;
  v_requires_capacity boolean;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_client_id := public.require_jsonb_uuid(p_payload #> '{client,id}', 'client.id');
  v_job_id := public.require_jsonb_uuid(p_payload #> '{job,id}', 'job.id');
  v_invoice_id := public.require_jsonb_uuid(p_payload #> '{invoice,id}', 'invoice.id');
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  if not exists (
    select 1 from public.clients as client
    where client.user_id = v_user_id and client.id = v_client_id
  ) then
    select count(*) into v_count from public.clients as client
    where client.user_id = v_user_id;
    if v_count >= 10 then
      perform public.fieldcraft_consume_admission(
        v_user_id, p_mutation_id, 'create-client'
      );
    end if;
  end if;

  select job.status into v_existing_job_status
  from public.jobs as job
  where job.user_id = v_user_id and job.id = v_job_id;
  v_requires_capacity := not found
    or v_existing_job_status not in ('Scheduled', 'In Progress');
  if v_requires_capacity
    and coalesce(p_payload #>> '{job,status}', 'Scheduled') in ('Scheduled', 'In Progress')
  then
    select count(*) into v_count from public.jobs as job
    where job.user_id = v_user_id
      and job.status in ('Scheduled', 'In Progress');
    if v_count >= 3 then
      perform public.fieldcraft_consume_admission(
        v_user_id, p_mutation_id, 'create-open-job'
      );
    end if;
  end if;

  select invoice.status into v_existing_invoice_status
  from public.invoices as invoice
  where invoice.user_id = v_user_id and invoice.id = v_invoice_id;
  v_requires_capacity := not found
    or v_existing_invoice_status not in ('Sent', 'Viewed', 'Partially Paid', 'Paid');
  if v_requires_capacity
    and coalesce(p_payload #>> '{invoice,status}', 'Draft') in (
    'Sent', 'Viewed', 'Partially Paid', 'Paid'
  ) then
    select count(*) into v_count from public.invoices as invoice
      where invoice.user_id = v_user_id
      and invoice.status in ('Sent', 'Viewed', 'Partially Paid', 'Paid')
      and coalesce(invoice.sent_at, invoice.created_at)
        >= statement_timestamp() - interval '30 days';
    if v_count >= 5 then
      perform public.fieldcraft_consume_admission(
        v_user_id, p_mutation_id, 'issue-document'
      );
    end if;
  end if;

  return public.save_invoice_bundle_v2_internal(p_mutation_id, p_payload);
end
$$;

revoke execute on function public.save_invoice_bundle(uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.save_invoice_bundle(uuid, jsonb)
  to authenticated;
