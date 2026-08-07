alter table public.profiles
  add column country_code text not null default 'US'
    check (country_code = 'US'),
  add column currency text not null default 'USD'
    check (currency = 'USD'),
  add column time_zone text not null default 'UTC'
    check (char_length(time_zone) between 1 and 100),
  add column onboarding_version integer not null default 0
    check (onboarding_version in (0, 1)),
  add column onboarding_completed_at timestamptz;

alter table public.profiles
  add constraint profiles_onboarding_completion_check check (
    (onboarding_version = 0 and onboarding_completed_at is null)
    or (onboarding_version = 1 and onboarding_completed_at is not null)
  );

create or replace function public.fieldcraft_require_aal2()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'AAL2_REQUIRED';
  end if;
end;
$$;

revoke execute on function public.fieldcraft_require_aal2() from public, anon;
grant execute on function public.fieldcraft_require_aal2() to authenticated;

create or replace function public.save_fieldcraft_onboarding(
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
  v_cloud jsonb;
  v_change_seq bigint;
  v_change_id bigint;
  v_change_updated_at timestamptz;
  v_previous_mutation_id text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mutation ID and onboarding payload are required' using errcode = '22023';
  end if;
  if p_payload ->> 'id' <> v_user_id::text
    or p_payload ->> 'ownerId' <> v_user_id::text
  then
    raise exception 'profile identity must match the authenticated user' using errcode = '42501';
  end if;
  if char_length(coalesce(p_payload ->> 'displayName', '')) not between 1 and 100
    or char_length(coalesce(p_payload ->> 'businessName', '')) not between 1 and 120
    or p_payload ->> 'tradeType' not in (
      'Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting'
    )
    or p_payload ->> 'paymentTerms' not in ('Due on receipt', 'Net 14', 'Net 30')
    or p_payload ->> 'countryCode' <> 'US'
    or p_payload ->> 'currency' <> 'USD'
    or char_length(coalesce(p_payload ->> 'timeZone', '')) not between 1 and 100
    or public.require_jsonb_integer(p_payload -> 'hourlyRateCents', 'hourlyRateCents', 1, 100000000) < 1
    or public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000) < 0
    or public.require_jsonb_integer(p_payload -> 'onboardingVersion', 'onboardingVersion', 1, 1) <> 1
    or nullif(p_payload ->> 'onboardingCompletedAt', '') is null
  then
    raise exception 'onboarding payload is invalid' using errcode = '22023';
  end if;

  perform public.fieldcraft_lock_sync_owner(v_user_id, p_mutation_id);
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));

  select receipt.response into v_response
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id
    and receipt.mutation_id = p_mutation_id;
  if found then
    if v_response ->> 'mutation_id' <> p_mutation_id::text
      or v_response ->> 'entity_id' <> v_user_id::text
      or v_response ->> 'entity' <> 'profile'
      or v_response ->> 'kind' <> 'create'
    then
      raise exception 'stored onboarding receipt identity is invalid' using errcode = '22023';
    end if;
    return v_response;
  end if;

  v_previous_mutation_id := current_setting('fieldcraft.mutation_id', true);
  perform set_config('fieldcraft.mutation_id', p_mutation_id::text, true);
  begin
    insert into public.profiles as profile (
      id,
      display_name,
      business_name,
      trade_type,
      hourly_rate_cents,
      tax_basis_points,
      payment_terms,
      country_code,
      currency,
      time_zone,
      onboarding_version,
      onboarding_completed_at,
      onboarding_complete
    ) values (
      v_user_id,
      p_payload ->> 'displayName',
      p_payload ->> 'businessName',
      p_payload ->> 'tradeType',
      public.require_jsonb_integer(p_payload -> 'hourlyRateCents', 'hourlyRateCents', 1, 100000000),
      public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000)::integer,
      p_payload ->> 'paymentTerms',
      'US',
      'USD',
      p_payload ->> 'timeZone',
      1,
      (p_payload ->> 'onboardingCompletedAt')::timestamptz,
      true
    )
    on conflict (id) do update set
      display_name = excluded.display_name,
      business_name = excluded.business_name,
      trade_type = excluded.trade_type,
      hourly_rate_cents = excluded.hourly_rate_cents,
      tax_basis_points = excluded.tax_basis_points,
      payment_terms = excluded.payment_terms,
      country_code = excluded.country_code,
      currency = excluded.currency,
      time_zone = excluded.time_zone,
      onboarding_version = excluded.onboarding_version,
      onboarding_completed_at = excluded.onboarding_completed_at,
      onboarding_complete = true
    returning to_jsonb(profile) into v_cloud;
  exception when others then
    perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);
    raise;
  end;
  perform set_config('fieldcraft.mutation_id', coalesce(v_previous_mutation_id, ''), true);

  select change.change_seq, change.change_id, change.updated_at
  into v_change_seq, v_change_id, v_change_updated_at
  from public.sync_changes as change
  where change.user_id = v_user_id
    and change.mutation_id = p_mutation_id
    and change.entity = 'profile'
    and change.entity_id = v_user_id
  order by change.change_seq desc
  limit 1;
  if v_change_seq is null then
    raise exception 'onboarding synchronization position is missing' using errcode = '55000';
  end if;

  v_response := jsonb_build_object(
    'status', 'applied',
    'mutation_id', p_mutation_id,
    'entity', 'profile',
    'kind', 'create',
    'entity_id', v_user_id,
    'cloud', v_cloud,
    'sync_position', jsonb_build_object(
      'updated_at', v_change_updated_at,
      'change_seq', v_change_seq,
      'change_id', v_change_id,
      'source', 'sync_changes'
    )
  );
  insert into public.mutation_receipts (user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke execute on function public.save_fieldcraft_onboarding(uuid, jsonb)
  from public, anon;
grant execute on function public.save_fieldcraft_onboarding(uuid, jsonb)
  to authenticated;
