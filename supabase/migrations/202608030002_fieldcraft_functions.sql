create or replace function public.require_jsonb_integer(
  p_value jsonb,
  p_field text,
  p_minimum numeric,
  p_maximum numeric
)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value numeric;
begin
  if p_value is null
    or jsonb_typeof(p_value) <> 'number'
    or p_value #>> '{}' !~ '^-?[0-9]+$'
  then
    raise exception '% must be an integer', p_field using errcode = '22023';
  end if;

  v_value := (p_value #>> '{}')::numeric;
  if v_value < p_minimum or v_value > p_maximum then
    raise exception '% must be between % and %', p_field, p_minimum, p_maximum
      using errcode = '22023';
  end if;

  return v_value::bigint;
end;
$$;

create or replace function public.require_jsonb_uuid(p_value jsonb, p_field text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value uuid;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    raise exception '% must be a UUID string', p_field using errcode = '22023';
  end if;

  begin
    v_value := (p_value #>> '{}')::uuid;
  exception when invalid_text_representation then
    raise exception '% must be a UUID string', p_field using errcode = '22023';
  end;

  return v_value;
end;
$$;

create or replace function public.invoice_subtotal_cents(p_line_items jsonb)
returns bigint
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_subtotal numeric;
begin
  if not public.is_valid_invoice_line_items(p_line_items) then
    raise exception 'invoice.lineItems does not match the FieldCraft v1 contract'
      using errcode = '22023';
  end if;

  select coalesce(sum(round(
    ((item ->> 'quantity')::numeric * (item ->> 'unitPriceCents')::numeric) / 1000
  )), 0)
  into v_subtotal
  from jsonb_array_elements(p_line_items) as entry(item);

  if v_subtotal < 0 or v_subtotal > 100000000 then
    raise exception 'calculated invoice subtotal must be between 0 and 100000000 cents'
      using errcode = '22023';
  end if;

  return v_subtotal::bigint;
end;
$$;

create or replace function public.save_invoice_bundle(
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
  v_existing_response jsonb;
  v_client_id uuid;
  v_job_id uuid;
  v_invoice_id uuid;
  v_row_owner uuid;
  v_row_version bigint;
  v_line_items jsonb;
  v_subtotal_cents bigint;
  v_tax_basis_points integer;
  v_tax_cents bigint;
  v_total_cents bigint;
  v_client public.clients%rowtype;
  v_job public.jobs%rowtype;
  v_invoice public.invoices%rowtype;
  v_response jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_mutation_id is null then
    raise exception 'p_mutation_id is required' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be an object' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_mutation_id::text, 0));

  select receipt.response
  into v_existing_response
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id
    and receipt.mutation_id = p_mutation_id;

  if found then
    return v_existing_response;
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

  if nullif(btrim(p_payload #>> '{client,name}'), '') is null
    or nullif(btrim(p_payload #>> '{job,title}'), '') is null
    or nullif(btrim(p_payload #>> '{invoice,number}'), '') is null
  then
    raise exception 'client.name, job.title, and invoice.number are required'
      using errcode = '22023';
  end if;

  v_line_items := p_payload #> '{invoice,lineItems}';
  v_subtotal_cents := public.invoice_subtotal_cents(v_line_items);
  v_tax_basis_points := public.require_jsonb_integer(
    p_payload #> '{invoice,taxBasisPoints}', 'invoice.taxBasisPoints', 0, 10000
  )::integer;
  v_tax_cents := round((v_subtotal_cents::numeric * v_tax_basis_points::numeric) / 10000)::bigint;
  v_total_cents := v_subtotal_cents + v_tax_cents;

  if v_total_cents > 100000000 then
    raise exception 'calculated invoice total must be at most 100000000 cents'
      using errcode = '22023';
  end if;
  if public.require_jsonb_integer(
    p_payload #> '{invoice,subtotalCents}', 'invoice.subtotalCents', 0, 100000000
  ) <> v_subtotal_cents
    or public.require_jsonb_integer(
      p_payload #> '{invoice,taxCents}', 'invoice.taxCents', 0, 100000000
    ) <> v_tax_cents
    or public.require_jsonb_integer(
      p_payload #> '{invoice,totalCents}', 'invoice.totalCents', 0, 100000000
    ) <> v_total_cents
  then
    raise exception 'invoice totals do not match deterministic server calculations'
      using errcode = '22023';
  end if;

  select client.user_id, client.version
  into v_row_owner, v_row_version
  from public.clients as client
  where client.id = v_client_id
  for update;

  if found and v_row_owner <> v_user_id then
    raise exception 'client does not belong to the authenticated user' using errcode = '42501';
  elsif found then
    if not ((p_payload -> 'client') ? 'baseVersion')
      or public.require_jsonb_integer(p_payload #> '{client,baseVersion}', 'client.baseVersion', 1, 9223372036854775807) <> v_row_version
    then
      raise exception 'stale client base version' using errcode = '40001';
    end if;
    update public.clients as client
    set
      name = p_payload #>> '{client,name}',
      phone = case when (p_payload -> 'client') ? 'phone' then nullif(p_payload #>> '{client,phone}', '') else client.phone end,
      email = case when (p_payload -> 'client') ? 'email' then nullif(p_payload #>> '{client,email}', '') else client.email end,
      address = case when (p_payload -> 'client') ? 'address' then nullif(p_payload #>> '{client,address}', '') else client.address end,
      city = case when (p_payload -> 'client') ? 'city' then nullif(p_payload #>> '{client,city}', '') else client.city end,
      state = case when (p_payload -> 'client') ? 'state' then nullif(p_payload #>> '{client,state}', '') else client.state end,
      postal_code = case when (p_payload -> 'client') ? 'postalCode' then nullif(p_payload #>> '{client,postalCode}', '') else client.postal_code end,
      notes = case when (p_payload -> 'client') ? 'notes' then nullif(p_payload #>> '{client,notes}', '') else client.notes end
    where client.id = v_client_id and client.user_id = v_user_id
    returning client.* into v_client;
  else
    insert into public.clients as client (
      id, user_id, name, phone, email, address, city, state, postal_code, notes
    ) values (
      v_client_id,
      v_user_id,
      p_payload #>> '{client,name}',
      nullif(p_payload #>> '{client,phone}', ''),
      nullif(p_payload #>> '{client,email}', ''),
      nullif(p_payload #>> '{client,address}', ''),
      nullif(p_payload #>> '{client,city}', ''),
      nullif(p_payload #>> '{client,state}', ''),
      nullif(p_payload #>> '{client,postalCode}', ''),
      nullif(p_payload #>> '{client,notes}', '')
    ) returning client.* into v_client;
  end if;

  select job.user_id, job.version
  into v_row_owner, v_row_version
  from public.jobs as job
  where job.id = v_job_id
  for update;

  if found and v_row_owner <> v_user_id then
    raise exception 'job does not belong to the authenticated user' using errcode = '42501';
  elsif found then
    if not ((p_payload -> 'job') ? 'baseVersion')
      or public.require_jsonb_integer(p_payload #> '{job,baseVersion}', 'job.baseVersion', 1, 9223372036854775807) <> v_row_version
    then
      raise exception 'stale job base version' using errcode = '40001';
    end if;
    update public.jobs as job
    set
      client_id = v_client_id,
      title = p_payload #>> '{job,title}',
      address = case when (p_payload -> 'job') ? 'address' then nullif(p_payload #>> '{job,address}', '') else job.address end,
      description = case when (p_payload -> 'job') ? 'description' then nullif(p_payload #>> '{job,description}', '') else job.description end,
      trade_type = p_payload #>> '{job,tradeType}',
      status = p_payload #>> '{job,status}',
      labor_hours_thousandths = case when (p_payload -> 'job') ? 'laborHoursThousandths'
        then public.require_jsonb_integer(p_payload #> '{job,laborHoursThousandths}', 'job.laborHoursThousandths', 0, 10000000)::integer
        else job.labor_hours_thousandths end,
      labor_rate_cents = case when (p_payload -> 'job') ? 'laborRateCents'
        then public.require_jsonb_integer(p_payload #> '{job,laborRateCents}', 'job.laborRateCents', 0, 100000000)
        else job.labor_rate_cents end,
      notes = case when (p_payload -> 'job') ? 'notes' then nullif(p_payload #>> '{job,notes}', '') else job.notes end
    where job.id = v_job_id and job.user_id = v_user_id
    returning job.* into v_job;
  else
    insert into public.jobs as job (
      id, user_id, client_id, title, address, description, trade_type, status,
      labor_hours_thousandths, labor_rate_cents, notes
    ) values (
      v_job_id,
      v_user_id,
      v_client_id,
      p_payload #>> '{job,title}',
      nullif(p_payload #>> '{job,address}', ''),
      nullif(p_payload #>> '{job,description}', ''),
      p_payload #>> '{job,tradeType}',
      p_payload #>> '{job,status}',
      case when (p_payload -> 'job') ? 'laborHoursThousandths'
        then public.require_jsonb_integer(p_payload #> '{job,laborHoursThousandths}', 'job.laborHoursThousandths', 0, 10000000)::integer else 0 end,
      case when (p_payload -> 'job') ? 'laborRateCents'
        then public.require_jsonb_integer(p_payload #> '{job,laborRateCents}', 'job.laborRateCents', 0, 100000000) else 0 end,
      nullif(p_payload #>> '{job,notes}', '')
    ) returning job.* into v_job;
  end if;

  select invoice.user_id, invoice.version
  into v_row_owner, v_row_version
  from public.invoices as invoice
  where invoice.id = v_invoice_id
  for update;

  if found and v_row_owner <> v_user_id then
    raise exception 'invoice does not belong to the authenticated user' using errcode = '42501';
  elsif found then
    if not ((p_payload -> 'invoice') ? 'baseVersion')
      or public.require_jsonb_integer(p_payload #> '{invoice,baseVersion}', 'invoice.baseVersion', 1, 9223372036854775807) <> v_row_version
    then
      raise exception 'stale invoice base version' using errcode = '40001';
    end if;
    update public.invoices as invoice
    set
      client_id = v_client_id,
      job_id = v_job_id,
      number = p_payload #>> '{invoice,number}',
      line_items = v_line_items,
      subtotal_cents = v_subtotal_cents,
      tax_basis_points = v_tax_basis_points,
      tax_cents = v_tax_cents,
      total_cents = v_total_cents,
      payment_terms = p_payload #>> '{invoice,paymentTerms}',
      status = p_payload #>> '{invoice,status}',
      notes = case when (p_payload -> 'invoice') ? 'notes' then nullif(p_payload #>> '{invoice,notes}', '') else invoice.notes end
    where invoice.id = v_invoice_id and invoice.user_id = v_user_id
    returning invoice.* into v_invoice;
  else
    insert into public.invoices as invoice (
      id, user_id, client_id, job_id, number, line_items, subtotal_cents,
      tax_basis_points, tax_cents, total_cents, payment_terms, status, notes
    ) values (
      v_invoice_id,
      v_user_id,
      v_client_id,
      v_job_id,
      p_payload #>> '{invoice,number}',
      v_line_items,
      v_subtotal_cents,
      v_tax_basis_points,
      v_tax_cents,
      v_total_cents,
      p_payload #>> '{invoice,paymentTerms}',
      p_payload #>> '{invoice,status}',
      nullif(p_payload #>> '{invoice,notes}', '')
    ) returning invoice.* into v_invoice;
  end if;

  v_response := jsonb_build_object(
    'status', 'applied',
    'client', to_jsonb(v_client),
    'job', to_jsonb(v_job),
    'invoice', to_jsonb(v_invoice)
  );

  insert into public.mutation_receipts (user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);

  return v_response;
end;
$$;

create or replace function public.apply_entity_mutation(
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
  v_existing_response jsonb;
  v_cloud jsonb;
  v_cloud_version bigint;
  v_response jsonb;
  v_client_id uuid;
  v_job_id uuid;
  v_line_items jsonb;
  v_subtotal_cents bigint;
  v_tax_basis_points integer;
  v_tax_cents bigint;
  v_total_cents bigint;
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

  select receipt.response
  into v_existing_response
  from public.mutation_receipts as receipt
  where receipt.user_id = v_user_id
    and receipt.mutation_id = p_mutation_id;
  if found then
    return v_existing_response;
  end if;

  if p_kind = 'create' then
    if p_base_version is not null then
      raise exception 'create mutations require a null base version' using errcode = '22023';
    end if;

    case p_entity
      when 'profile' then
        if p_entity_id <> v_user_id then
          raise exception 'profile ID must match the authenticated user' using errcode = '42501';
        end if;
        insert into public.profiles as profile (
          id, display_name, business_name, trade_type, phone, email, address,
          license_number, hourly_rate_cents, tax_basis_points, payment_terms,
          logo_path, onboarding_complete, has_seen_demo
        ) values (
          v_user_id,
          coalesce(p_payload ->> 'displayName', ''),
          coalesce(p_payload ->> 'businessName', ''),
          coalesce(p_payload ->> 'tradeType', 'General'),
          nullif(p_payload ->> 'phone', ''),
          nullif(p_payload ->> 'email', ''),
          nullif(p_payload ->> 'address', ''),
          nullif(p_payload ->> 'licenseNumber', ''),
          case when p_payload ? 'hourlyRateCents' then public.require_jsonb_integer(p_payload -> 'hourlyRateCents', 'hourlyRateCents', 0, 100000000) else 0 end,
          case when p_payload ? 'taxBasisPoints' then public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000)::integer else 0 end,
          coalesce(p_payload ->> 'paymentTerms', 'Due on receipt'),
          nullif(p_payload ->> 'logoPath', ''),
          coalesce((p_payload ->> 'onboardingComplete')::boolean, false),
          coalesce((p_payload ->> 'hasSeenDemo')::boolean, false)
        ) returning to_jsonb(profile) into v_cloud;

      when 'client' then
        insert into public.clients as client (
          id, user_id, name, phone, email, address, city, state, postal_code, notes
        ) values (
          p_entity_id, v_user_id, p_payload ->> 'name', nullif(p_payload ->> 'phone', ''),
          nullif(p_payload ->> 'email', ''), nullif(p_payload ->> 'address', ''),
          nullif(p_payload ->> 'city', ''), nullif(p_payload ->> 'state', ''),
          nullif(p_payload ->> 'postalCode', ''), nullif(p_payload ->> 'notes', '')
        ) returning to_jsonb(client) into v_cloud;

      when 'job' then
        v_client_id := public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId');
        perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
        if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
        insert into public.jobs as job (
          id, user_id, client_id, title, address, description, trade_type, status,
          labor_hours_thousandths, labor_rate_cents, notes, scheduled_at, completed_at
        ) values (
          p_entity_id, v_user_id, v_client_id, p_payload ->> 'title', nullif(p_payload ->> 'address', ''),
          nullif(p_payload ->> 'description', ''), p_payload ->> 'tradeType', coalesce(p_payload ->> 'status', 'Scheduled'),
          case when p_payload ? 'laborHoursThousandths' then public.require_jsonb_integer(p_payload -> 'laborHoursThousandths', 'laborHoursThousandths', 0, 10000000)::integer else 0 end,
          case when p_payload ? 'laborRateCents' then public.require_jsonb_integer(p_payload -> 'laborRateCents', 'laborRateCents', 0, 100000000) else 0 end,
          nullif(p_payload ->> 'notes', ''), (p_payload ->> 'scheduledAt')::timestamptz, (p_payload ->> 'completedAt')::timestamptz
        ) returning to_jsonb(job) into v_cloud;

      when 'invoice' then
        v_client_id := public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId');
        perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
        if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
        if p_payload ? 'jobId' and p_payload -> 'jobId' <> 'null'::jsonb then
          v_job_id := public.require_jsonb_uuid(p_payload -> 'jobId', 'jobId');
          perform 1 from public.jobs where id = v_job_id and user_id = v_user_id and client_id = v_client_id for key share;
          if not found then raise exception 'owned job for client not found' using errcode = '22023'; end if;
        end if;
        v_line_items := p_payload -> 'lineItems';
        v_subtotal_cents := public.invoice_subtotal_cents(v_line_items);
        v_tax_basis_points := public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000)::integer;
        v_tax_cents := round((v_subtotal_cents::numeric * v_tax_basis_points::numeric) / 10000)::bigint;
        v_total_cents := v_subtotal_cents + v_tax_cents;
        if v_total_cents > 100000000 then raise exception 'invoice total is too large' using errcode = '22023'; end if;
        if public.require_jsonb_integer(p_payload -> 'subtotalCents', 'subtotalCents', 0, 100000000) <> v_subtotal_cents
          or public.require_jsonb_integer(p_payload -> 'taxCents', 'taxCents', 0, 100000000) <> v_tax_cents
          or public.require_jsonb_integer(p_payload -> 'totalCents', 'totalCents', 0, 100000000) <> v_total_cents
        then raise exception 'invoice totals do not match deterministic server calculations' using errcode = '22023'; end if;
        insert into public.invoices as invoice (
          id, user_id, client_id, job_id, number, line_items, subtotal_cents,
          tax_basis_points, tax_cents, total_cents, payment_terms, status, notes
        ) values (
          p_entity_id, v_user_id, v_client_id, v_job_id, p_payload ->> 'number', v_line_items,
          v_subtotal_cents, v_tax_basis_points, v_tax_cents, v_total_cents,
          p_payload ->> 'paymentTerms', coalesce(p_payload ->> 'status', 'Draft'), nullif(p_payload ->> 'notes', '')
        ) returning to_jsonb(invoice) into v_cloud;

      when 'expense' then
        if p_payload ? 'jobId' and p_payload -> 'jobId' <> 'null'::jsonb then
          v_job_id := public.require_jsonb_uuid(p_payload -> 'jobId', 'jobId');
          perform 1 from public.jobs where id = v_job_id and user_id = v_user_id for key share;
          if not found then raise exception 'owned job not found' using errcode = '22023'; end if;
        end if;
        if p_payload ? 'clientId' and p_payload -> 'clientId' <> 'null'::jsonb then
          v_client_id := public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId');
          perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
          if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
        end if;
        insert into public.expenses as expense (
          id, user_id, job_id, client_id, vendor, amount_cents, category,
          expense_date, notes, receipt_path
        ) values (
          p_entity_id, v_user_id, v_job_id, v_client_id, p_payload ->> 'vendor',
          public.require_jsonb_integer(p_payload -> 'amountCents', 'amountCents', 0, 100000000),
          coalesce(p_payload ->> 'category', 'Other'), (p_payload ->> 'expenseDate')::date,
          nullif(p_payload ->> 'notes', ''), nullif(p_payload ->> 'receiptPath', '')
        ) returning to_jsonb(expense) into v_cloud;

      when 'service' then
        insert into public.services as service (
          id, user_id, name, description, estimated_hours_thousandths,
          unit_price_cents, category
        ) values (
          p_entity_id, v_user_id, p_payload ->> 'name', nullif(p_payload ->> 'description', ''),
          case when p_payload ? 'estimatedHoursThousandths' then public.require_jsonb_integer(p_payload -> 'estimatedHoursThousandths', 'estimatedHoursThousandths', 0, 10000000)::integer else 0 end,
          case when p_payload ? 'unitPriceCents' then public.require_jsonb_integer(p_payload -> 'unitPriceCents', 'unitPriceCents', 0, 100000000) else 0 end,
          nullif(p_payload ->> 'category', '')
        ) returning to_jsonb(service) into v_cloud;

      when 'inventory' then
        insert into public.inventory_items as inventory (
          id, user_id, name, quantity_thousandths, unit, min_stock_thousandths,
          unit_price_cents, last_used_at
        ) values (
          p_entity_id, v_user_id, p_payload ->> 'name',
          case when p_payload ? 'quantityThousandths' then public.require_jsonb_integer(p_payload -> 'quantityThousandths', 'quantityThousandths', 0, 1000000000) else 0 end,
          p_payload ->> 'unit',
          case when p_payload ? 'minStockThousandths' then public.require_jsonb_integer(p_payload -> 'minStockThousandths', 'minStockThousandths', 0, 1000000000) else 0 end,
          case when p_payload ? 'unitPriceCents' then public.require_jsonb_integer(p_payload -> 'unitPriceCents', 'unitPriceCents', 0, 100000000) else 0 end,
          (p_payload ->> 'lastUsedAt')::timestamptz
        ) returning to_jsonb(inventory) into v_cloud;
    end case;

  else
    if p_base_version is null or p_base_version < 1 then
      raise exception 'update and delete mutations require a positive base version'
        using errcode = '22023';
    end if;

    case p_entity
      when 'profile' then
        if p_entity_id <> v_user_id then raise exception 'entity not found' using errcode = '22023'; end if;
        select to_jsonb(profile), profile.version into v_cloud, v_cloud_version
        from public.profiles as profile where profile.id = v_user_id for update;
      when 'client' then
        select to_jsonb(client), client.version into v_cloud, v_cloud_version
        from public.clients as client where client.id = p_entity_id and client.user_id = v_user_id for update;
      when 'job' then
        select to_jsonb(job), job.version into v_cloud, v_cloud_version
        from public.jobs as job where job.id = p_entity_id and job.user_id = v_user_id for update;
      when 'invoice' then
        select to_jsonb(invoice), invoice.version into v_cloud, v_cloud_version
        from public.invoices as invoice where invoice.id = p_entity_id and invoice.user_id = v_user_id for update;
      when 'expense' then
        select to_jsonb(expense), expense.version into v_cloud, v_cloud_version
        from public.expenses as expense where expense.id = p_entity_id and expense.user_id = v_user_id for update;
      when 'service' then
        select to_jsonb(service), service.version into v_cloud, v_cloud_version
        from public.services as service where service.id = p_entity_id and service.user_id = v_user_id for update;
      when 'inventory' then
        select to_jsonb(inventory), inventory.version into v_cloud, v_cloud_version
        from public.inventory_items as inventory where inventory.id = p_entity_id and inventory.user_id = v_user_id for update;
    end case;

    if v_cloud is null then
      raise exception 'entity not found' using errcode = '22023';
    end if;

    if v_cloud_version <> p_base_version then
      v_response := jsonb_build_object(
        'status', 'conflict',
        'entity', p_entity,
        'entity_id', p_entity_id,
        'base_version', p_base_version,
        'cloud_version', v_cloud_version,
        'cloud', v_cloud
      );
      insert into public.mutation_receipts (user_id, mutation_id, response)
      values (v_user_id, p_mutation_id, v_response);
      return v_response;
    end if;

    if p_kind = 'delete' then
      case p_entity
        when 'profile' then delete from public.profiles where id = v_user_id;
        when 'client' then delete from public.clients where id = p_entity_id and user_id = v_user_id;
        when 'job' then delete from public.jobs where id = p_entity_id and user_id = v_user_id;
        when 'invoice' then delete from public.invoices where id = p_entity_id and user_id = v_user_id;
        when 'expense' then delete from public.expenses where id = p_entity_id and user_id = v_user_id;
        when 'service' then delete from public.services where id = p_entity_id and user_id = v_user_id;
        when 'inventory' then delete from public.inventory_items where id = p_entity_id and user_id = v_user_id;
      end case;
      v_response := jsonb_build_object(
        'status', 'applied', 'entity', p_entity, 'kind', p_kind,
        'entity_id', p_entity_id, 'deleted_version', v_cloud_version
      );
    else
      case p_entity
        when 'profile' then
          update public.profiles as profile set
            display_name = case when p_payload ? 'displayName' then p_payload ->> 'displayName' else profile.display_name end,
            business_name = case when p_payload ? 'businessName' then p_payload ->> 'businessName' else profile.business_name end,
            trade_type = case when p_payload ? 'tradeType' then p_payload ->> 'tradeType' else profile.trade_type end,
            phone = case when p_payload ? 'phone' then nullif(p_payload ->> 'phone', '') else profile.phone end,
            email = case when p_payload ? 'email' then nullif(p_payload ->> 'email', '') else profile.email end,
            address = case when p_payload ? 'address' then nullif(p_payload ->> 'address', '') else profile.address end,
            license_number = case when p_payload ? 'licenseNumber' then nullif(p_payload ->> 'licenseNumber', '') else profile.license_number end,
            hourly_rate_cents = case when p_payload ? 'hourlyRateCents' then public.require_jsonb_integer(p_payload -> 'hourlyRateCents', 'hourlyRateCents', 0, 100000000) else profile.hourly_rate_cents end,
            tax_basis_points = case when p_payload ? 'taxBasisPoints' then public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000)::integer else profile.tax_basis_points end,
            payment_terms = case when p_payload ? 'paymentTerms' then p_payload ->> 'paymentTerms' else profile.payment_terms end,
            logo_path = case when p_payload ? 'logoPath' then nullif(p_payload ->> 'logoPath', '') else profile.logo_path end,
            onboarding_complete = case when p_payload ? 'onboardingComplete' then (p_payload ->> 'onboardingComplete')::boolean else profile.onboarding_complete end,
            has_seen_demo = case when p_payload ? 'hasSeenDemo' then (p_payload ->> 'hasSeenDemo')::boolean else profile.has_seen_demo end
          where profile.id = v_user_id returning to_jsonb(profile) into v_cloud;

        when 'client' then
          update public.clients as client set
            name = case when p_payload ? 'name' then p_payload ->> 'name' else client.name end,
            phone = case when p_payload ? 'phone' then nullif(p_payload ->> 'phone', '') else client.phone end,
            email = case when p_payload ? 'email' then nullif(p_payload ->> 'email', '') else client.email end,
            address = case when p_payload ? 'address' then nullif(p_payload ->> 'address', '') else client.address end,
            city = case when p_payload ? 'city' then nullif(p_payload ->> 'city', '') else client.city end,
            state = case when p_payload ? 'state' then nullif(p_payload ->> 'state', '') else client.state end,
            postal_code = case when p_payload ? 'postalCode' then nullif(p_payload ->> 'postalCode', '') else client.postal_code end,
            notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else client.notes end
          where client.id = p_entity_id and client.user_id = v_user_id returning to_jsonb(client) into v_cloud;

        when 'job' then
          v_client_id := case when p_payload ? 'clientId' then public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId') else (v_cloud ->> 'client_id')::uuid end;
          perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
          if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
          update public.jobs as job set
            client_id = v_client_id,
            title = case when p_payload ? 'title' then p_payload ->> 'title' else job.title end,
            address = case when p_payload ? 'address' then nullif(p_payload ->> 'address', '') else job.address end,
            description = case when p_payload ? 'description' then nullif(p_payload ->> 'description', '') else job.description end,
            trade_type = case when p_payload ? 'tradeType' then p_payload ->> 'tradeType' else job.trade_type end,
            status = case when p_payload ? 'status' then p_payload ->> 'status' else job.status end,
            labor_hours_thousandths = case when p_payload ? 'laborHoursThousandths' then public.require_jsonb_integer(p_payload -> 'laborHoursThousandths', 'laborHoursThousandths', 0, 10000000)::integer else job.labor_hours_thousandths end,
            labor_rate_cents = case when p_payload ? 'laborRateCents' then public.require_jsonb_integer(p_payload -> 'laborRateCents', 'laborRateCents', 0, 100000000) else job.labor_rate_cents end,
            notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else job.notes end
          where job.id = p_entity_id and job.user_id = v_user_id returning to_jsonb(job) into v_cloud;

        when 'invoice' then
          v_client_id := case when p_payload ? 'clientId' then public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId') else (v_cloud ->> 'client_id')::uuid end;
          perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
          if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
          if p_payload ? 'jobId' then
            v_job_id := case when p_payload -> 'jobId' = 'null'::jsonb then null else public.require_jsonb_uuid(p_payload -> 'jobId', 'jobId') end;
          else
            v_job_id := (v_cloud ->> 'job_id')::uuid;
          end if;
          if v_job_id is not null then
            perform 1 from public.jobs where id = v_job_id and user_id = v_user_id and client_id = v_client_id for key share;
            if not found then raise exception 'owned job for client not found' using errcode = '22023'; end if;
          end if;
          v_line_items := case when p_payload ? 'lineItems' then p_payload -> 'lineItems' else v_cloud -> 'line_items' end;
          v_subtotal_cents := public.invoice_subtotal_cents(v_line_items);
          v_tax_basis_points := case when p_payload ? 'taxBasisPoints'
            then public.require_jsonb_integer(p_payload -> 'taxBasisPoints', 'taxBasisPoints', 0, 10000)::integer
            else (v_cloud ->> 'tax_basis_points')::integer end;
          v_tax_cents := round((v_subtotal_cents::numeric * v_tax_basis_points::numeric) / 10000)::bigint;
          v_total_cents := v_subtotal_cents + v_tax_cents;
          if v_total_cents > 100000000 then raise exception 'invoice total is too large' using errcode = '22023'; end if;
          if p_payload ? 'subtotalCents' and public.require_jsonb_integer(p_payload -> 'subtotalCents', 'subtotalCents', 0, 100000000) <> v_subtotal_cents
            or p_payload ? 'taxCents' and public.require_jsonb_integer(p_payload -> 'taxCents', 'taxCents', 0, 100000000) <> v_tax_cents
            or p_payload ? 'totalCents' and public.require_jsonb_integer(p_payload -> 'totalCents', 'totalCents', 0, 100000000) <> v_total_cents
          then raise exception 'invoice totals do not match deterministic server calculations' using errcode = '22023'; end if;
          update public.invoices as invoice set
            client_id = v_client_id, job_id = v_job_id,
            number = case when p_payload ? 'number' then p_payload ->> 'number' else invoice.number end,
            line_items = v_line_items, subtotal_cents = v_subtotal_cents,
            tax_basis_points = v_tax_basis_points, tax_cents = v_tax_cents, total_cents = v_total_cents,
            payment_terms = case when p_payload ? 'paymentTerms' then p_payload ->> 'paymentTerms' else invoice.payment_terms end,
            status = case when p_payload ? 'status' then p_payload ->> 'status' else invoice.status end,
            notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else invoice.notes end
          where invoice.id = p_entity_id and invoice.user_id = v_user_id returning to_jsonb(invoice) into v_cloud;

        when 'expense' then
          if p_payload ? 'jobId' then
            v_job_id := case when p_payload -> 'jobId' = 'null'::jsonb then null else public.require_jsonb_uuid(p_payload -> 'jobId', 'jobId') end;
            if v_job_id is not null then
              perform 1 from public.jobs where id = v_job_id and user_id = v_user_id for key share;
              if not found then raise exception 'owned job not found' using errcode = '22023'; end if;
            end if;
          else v_job_id := (v_cloud ->> 'job_id')::uuid; end if;
          if p_payload ? 'clientId' then
            v_client_id := case when p_payload -> 'clientId' = 'null'::jsonb then null else public.require_jsonb_uuid(p_payload -> 'clientId', 'clientId') end;
            if v_client_id is not null then
              perform 1 from public.clients where id = v_client_id and user_id = v_user_id for key share;
              if not found then raise exception 'owned client not found' using errcode = '22023'; end if;
            end if;
          else v_client_id := (v_cloud ->> 'client_id')::uuid; end if;
          update public.expenses as expense set
            job_id = v_job_id, client_id = v_client_id,
            vendor = case when p_payload ? 'vendor' then p_payload ->> 'vendor' else expense.vendor end,
            amount_cents = case when p_payload ? 'amountCents' then public.require_jsonb_integer(p_payload -> 'amountCents', 'amountCents', 0, 100000000) else expense.amount_cents end,
            category = case when p_payload ? 'category' then p_payload ->> 'category' else expense.category end,
            expense_date = case when p_payload ? 'expenseDate' then (p_payload ->> 'expenseDate')::date else expense.expense_date end,
            notes = case when p_payload ? 'notes' then nullif(p_payload ->> 'notes', '') else expense.notes end,
            receipt_path = case when p_payload ? 'receiptPath' then nullif(p_payload ->> 'receiptPath', '') else expense.receipt_path end
          where expense.id = p_entity_id and expense.user_id = v_user_id returning to_jsonb(expense) into v_cloud;

        when 'service' then
          update public.services as service set
            name = case when p_payload ? 'name' then p_payload ->> 'name' else service.name end,
            description = case when p_payload ? 'description' then nullif(p_payload ->> 'description', '') else service.description end,
            estimated_hours_thousandths = case when p_payload ? 'estimatedHoursThousandths' then public.require_jsonb_integer(p_payload -> 'estimatedHoursThousandths', 'estimatedHoursThousandths', 0, 10000000)::integer else service.estimated_hours_thousandths end,
            unit_price_cents = case when p_payload ? 'unitPriceCents' then public.require_jsonb_integer(p_payload -> 'unitPriceCents', 'unitPriceCents', 0, 100000000) else service.unit_price_cents end,
            category = case when p_payload ? 'category' then nullif(p_payload ->> 'category', '') else service.category end
          where service.id = p_entity_id and service.user_id = v_user_id returning to_jsonb(service) into v_cloud;

        when 'inventory' then
          update public.inventory_items as inventory set
            name = case when p_payload ? 'name' then p_payload ->> 'name' else inventory.name end,
            quantity_thousandths = case when p_payload ? 'quantityThousandths' then public.require_jsonb_integer(p_payload -> 'quantityThousandths', 'quantityThousandths', 0, 1000000000) else inventory.quantity_thousandths end,
            unit = case when p_payload ? 'unit' then p_payload ->> 'unit' else inventory.unit end,
            min_stock_thousandths = case when p_payload ? 'minStockThousandths' then public.require_jsonb_integer(p_payload -> 'minStockThousandths', 'minStockThousandths', 0, 1000000000) else inventory.min_stock_thousandths end,
            unit_price_cents = case when p_payload ? 'unitPriceCents' then public.require_jsonb_integer(p_payload -> 'unitPriceCents', 'unitPriceCents', 0, 100000000) else inventory.unit_price_cents end,
            last_used_at = case when p_payload ? 'lastUsedAt' then (p_payload ->> 'lastUsedAt')::timestamptz else inventory.last_used_at end
          where inventory.id = p_entity_id and inventory.user_id = v_user_id returning to_jsonb(inventory) into v_cloud;
      end case;

      v_response := jsonb_build_object(
        'status', 'applied', 'entity', p_entity, 'kind', p_kind,
        'entity_id', p_entity_id, 'cloud', v_cloud
      );
    end if;
  end if;

  if v_response is null then
    v_response := jsonb_build_object(
      'status', 'applied', 'entity', p_entity, 'kind', p_kind,
      'entity_id', p_entity_id, 'cloud', v_cloud
    );
  end if;

  insert into public.mutation_receipts (user_id, mutation_id, response)
  values (v_user_id, p_mutation_id, v_response);
  return v_response;
end;
$$;

revoke execute on function public.require_jsonb_integer(jsonb, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.require_jsonb_uuid(jsonb, text) from public, anon, authenticated;
revoke execute on function public.invoice_subtotal_cents(jsonb) from public, anon, authenticated;

revoke execute on function public.save_invoice_bundle(uuid, jsonb) from public, anon;
grant execute on function public.save_invoice_bundle(uuid, jsonb) to authenticated;

revoke execute on function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb) from public, anon;
grant execute on function public.apply_entity_mutation(uuid, text, text, uuid, bigint, jsonb) to authenticated;
