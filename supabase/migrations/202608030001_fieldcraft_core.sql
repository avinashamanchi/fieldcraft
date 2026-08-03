create or replace function public.is_jsonb_integer_in_range(
  p_value jsonb,
  p_minimum numeric,
  p_maximum numeric
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_value) <> 'number' then false
    when p_value #>> '{}' !~ '^-?[0-9]+$' then false
    else (p_value #>> '{}')::numeric between p_minimum and p_maximum
  end
$$;

create or replace function public.is_valid_invoice_line_items(p_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'array' then false
    when jsonb_array_length(p_value) not between 1 and 100 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_value) as entry(item)
      where jsonb_typeof(item) <> 'object'
        or not (item ?& array['description', 'type', 'quantity', 'unitPriceCents'])
        or exists (
          select 1
          from jsonb_object_keys(item) as key(name)
          where name not in (
            'id', 'description', 'type', 'quantity', 'unitPriceCents', 'lineTotalCents'
          )
        )
        or jsonb_typeof(item -> 'description') <> 'string'
        or char_length(item ->> 'description') not between 1 and 500
        or jsonb_typeof(item -> 'type') <> 'string'
        or item ->> 'type' not in ('labor', 'material')
        or not public.is_jsonb_integer_in_range(item -> 'quantity', 0, 10000)
        or not public.is_jsonb_integer_in_range(item -> 'unitPriceCents', 0, 100000000)
        or (
          item ? 'id'
          and (
            jsonb_typeof(item -> 'id') <> 'string'
            or char_length(item ->> 'id') < 1
          )
        )
        or case when item ? 'lineTotalCents' then
          case when public.is_jsonb_integer_in_range(item -> 'lineTotalCents', 0, 100000000)
            and public.is_jsonb_integer_in_range(item -> 'quantity', 0, 10000)
            and public.is_jsonb_integer_in_range(item -> 'unitPriceCents', 0, 100000000)
          then (item ->> 'lineTotalCents')::numeric <>
            round(((item ->> 'quantity')::numeric * (item ->> 'unitPriceCents')::numeric) / 1000)
          else true end
        else false end
    )
  end
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 200),
  business_name text not null default '' check (char_length(business_name) <= 200),
  trade_type text not null default 'General'
    check (trade_type in ('Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting')),
  phone text check (phone is null or char_length(phone) <= 64),
  email text check (email is null or char_length(email) <= 320),
  address text check (address is null or char_length(address) <= 500),
  license_number text check (license_number is null or char_length(license_number) <= 100),
  hourly_rate_cents bigint not null default 0 check (hourly_rate_cents between 0 and 100000000),
  tax_basis_points integer not null default 0 check (tax_basis_points between 0 and 10000),
  payment_terms text not null default 'Due on receipt'
    check (payment_terms in ('Due on receipt', 'Net 14', 'Net 30')),
  logo_path text check (logo_path is null or char_length(logo_path) <= 500),
  onboarding_complete boolean not null default false,
  has_seen_demo boolean not null default false,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  phone text check (phone is null or char_length(phone) <= 64),
  email text check (email is null or char_length(email) <= 320),
  address text check (address is null or char_length(address) <= 500),
  city text check (city is null or char_length(city) <= 100),
  state text check (state is null or char_length(state) <= 100),
  postal_code text check (postal_code is null or char_length(postal_code) <= 32),
  notes text check (notes is null or char_length(notes) <= 4000),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint clients_user_id_id_key unique (user_id, id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  address text check (address is null or char_length(address) <= 500),
  description text check (description is null or char_length(description) <= 4000),
  trade_type text not null
    check (trade_type in ('Plumbing', 'Electrical', 'HVAC', 'Carpentry', 'General', 'Roofing', 'Flooring', 'Painting')),
  status text not null default 'Scheduled'
    check (status in ('Scheduled', 'In Progress', 'Invoiced', 'Paid')),
  labor_hours_thousandths integer not null default 0 check (labor_hours_thousandths between 0 and 10000000),
  labor_rate_cents bigint not null default 0 check (labor_rate_cents between 0 and 100000000),
  notes text check (notes is null or char_length(notes) <= 4000),
  scheduled_at timestamptz,
  completed_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint jobs_user_id_id_key unique (user_id, id),
  constraint jobs_user_id_client_id_id_key unique (user_id, client_id, id),
  constraint jobs_owned_client_fkey foreign key (user_id, client_id)
    references public.clients(user_id, id) on delete restrict
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  job_id uuid,
  number text not null check (char_length(number) between 1 and 64),
  line_items jsonb not null check (public.is_valid_invoice_line_items(line_items)),
  subtotal_cents bigint not null check (subtotal_cents between 0 and 100000000),
  tax_basis_points integer not null default 0 check (tax_basis_points between 0 and 10000),
  tax_cents bigint not null check (tax_cents between 0 and 100000000),
  total_cents bigint not null check (total_cents between 0 and 100000000),
  payment_terms text not null
    check (payment_terms in ('Due on receipt', 'Net 14', 'Net 30')),
  status text not null default 'Draft'
    check (status in ('Draft', 'Sent', 'Viewed', 'Partially Paid', 'Paid')),
  notes text check (notes is null or char_length(notes) <= 4000),
  sent_at timestamptz,
  paid_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint invoices_user_id_id_key unique (user_id, id),
  constraint invoices_user_id_number_key unique (user_id, number),
  constraint invoices_owned_client_fkey foreign key (user_id, client_id)
    references public.clients(user_id, id) on delete restrict,
  constraint invoices_owned_job_fkey foreign key (user_id, client_id, job_id)
    references public.jobs(user_id, client_id, id) on delete restrict
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid,
  client_id uuid,
  vendor text not null check (char_length(vendor) between 1 and 200),
  amount_cents bigint not null check (amount_cents between 0 and 100000000),
  category text not null default 'Other'
    check (category in ('Materials', 'Fuel', 'Equipment', 'Subcontractor', 'Other')),
  expense_date date not null,
  notes text check (notes is null or char_length(notes) <= 4000),
  receipt_path text check (receipt_path is null or char_length(receipt_path) <= 500),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint expenses_user_id_id_key unique (user_id, id),
  constraint expenses_owned_job_fkey foreign key (user_id, job_id)
    references public.jobs(user_id, id) on delete restrict,
  constraint expenses_owned_client_fkey foreign key (user_id, client_id)
    references public.clients(user_id, id) on delete restrict
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  description text check (description is null or char_length(description) <= 4000),
  estimated_hours_thousandths integer not null default 0 check (estimated_hours_thousandths between 0 and 10000000),
  unit_price_cents bigint not null default 0 check (unit_price_cents between 0 and 100000000),
  category text check (category is null or char_length(category) <= 100),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint services_user_id_id_key unique (user_id, id)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  quantity_thousandths bigint not null default 0 check (quantity_thousandths between 0 and 1000000000),
  unit text not null check (char_length(unit) between 1 and 32),
  min_stock_thousandths bigint not null default 0 check (min_stock_thousandths between 0 and 1000000000),
  unit_price_cents bigint not null default 0 check (unit_price_cents between 0 and 100000000),
  last_used_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint inventory_items_user_id_id_key unique (user_id, id)
);

create table public.mutation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  response jsonb not null,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, mutation_id)
);

create table public.ai_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count between 0 and 10000),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, window_started_at)
);

create index profiles_updated_at_idx on public.profiles (updated_at, id);
create index clients_user_updated_idx on public.clients (user_id, updated_at, id);
create index jobs_user_updated_idx on public.jobs (user_id, updated_at, id);
create index jobs_user_status_idx on public.jobs (user_id, status);
create index jobs_user_client_idx on public.jobs (user_id, client_id);
create index invoices_user_updated_idx on public.invoices (user_id, updated_at, id);
create index invoices_user_status_idx on public.invoices (user_id, status);
create index invoices_user_client_idx on public.invoices (user_id, client_id);
create index invoices_user_job_idx on public.invoices (user_id, job_id);
create index expenses_user_updated_idx on public.expenses (user_id, updated_at, id);
create index expenses_user_category_idx on public.expenses (user_id, category);
create index expenses_user_client_idx on public.expenses (user_id, client_id);
create index expenses_user_job_idx on public.expenses (user_id, job_id);
create index services_user_updated_idx on public.services (user_id, updated_at, id);
create index inventory_items_user_updated_idx on public.inventory_items (user_id, updated_at, id);
create index mutation_receipts_user_updated_idx on public.mutation_receipts (user_id, updated_at);
create index ai_rate_limits_user_updated_idx on public.ai_rate_limits (user_id, updated_at);

create or replace function public.bump_version_and_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.version := old.version + 1;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger profiles_bump_version before update on public.profiles
for each row execute function public.bump_version_and_updated_at();
create trigger clients_bump_version before update on public.clients
for each row execute function public.bump_version_and_updated_at();
create trigger jobs_bump_version before update on public.jobs
for each row execute function public.bump_version_and_updated_at();
create trigger invoices_bump_version before update on public.invoices
for each row execute function public.bump_version_and_updated_at();
create trigger expenses_bump_version before update on public.expenses
for each row execute function public.bump_version_and_updated_at();
create trigger services_bump_version before update on public.services
for each row execute function public.bump_version_and_updated_at();
create trigger inventory_items_bump_version before update on public.inventory_items
for each row execute function public.bump_version_and_updated_at();
create trigger mutation_receipts_bump_version before update on public.mutation_receipts
for each row execute function public.bump_version_and_updated_at();
create trigger ai_rate_limits_bump_version before update on public.ai_rate_limits
for each row execute function public.bump_version_and_updated_at();

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.jobs enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.services enable row level security;
alter table public.inventory_items enable row level security;
alter table public.mutation_receipts enable row level security;
alter table public.ai_rate_limits enable row level security;

create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy profiles_delete_own on public.profiles for delete using (auth.uid() = id);

create policy clients_select_own on public.clients for select using (auth.uid() = user_id);
create policy clients_insert_own on public.clients for insert with check (auth.uid() = user_id);
create policy clients_update_own on public.clients for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy clients_delete_own on public.clients for delete using (auth.uid() = user_id);

create policy jobs_select_own on public.jobs for select using (auth.uid() = user_id);
create policy jobs_insert_own on public.jobs for insert with check (auth.uid() = user_id);
create policy jobs_update_own on public.jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy jobs_delete_own on public.jobs for delete using (auth.uid() = user_id);

create policy invoices_select_own on public.invoices for select using (auth.uid() = user_id);
create policy invoices_insert_own on public.invoices for insert with check (auth.uid() = user_id);
create policy invoices_update_own on public.invoices for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy invoices_delete_own on public.invoices for delete using (auth.uid() = user_id);

create policy expenses_select_own on public.expenses for select using (auth.uid() = user_id);
create policy expenses_insert_own on public.expenses for insert with check (auth.uid() = user_id);
create policy expenses_update_own on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy expenses_delete_own on public.expenses for delete using (auth.uid() = user_id);

create policy services_select_own on public.services for select using (auth.uid() = user_id);
create policy services_insert_own on public.services for insert with check (auth.uid() = user_id);
create policy services_update_own on public.services for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy services_delete_own on public.services for delete using (auth.uid() = user_id);

create policy inventory_items_select_own on public.inventory_items for select using (auth.uid() = user_id);
create policy inventory_items_insert_own on public.inventory_items for insert with check (auth.uid() = user_id);
create policy inventory_items_update_own on public.inventory_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy inventory_items_delete_own on public.inventory_items for delete using (auth.uid() = user_id);

create policy mutation_receipts_select_own on public.mutation_receipts for select using (auth.uid() = user_id);
create policy mutation_receipts_insert_own on public.mutation_receipts for insert with check (auth.uid() = user_id);
create policy mutation_receipts_update_own on public.mutation_receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy mutation_receipts_delete_own on public.mutation_receipts for delete using (auth.uid() = user_id);

create policy ai_rate_limits_select_own on public.ai_rate_limits for select using (auth.uid() = user_id);
create policy ai_rate_limits_insert_own on public.ai_rate_limits for insert with check (auth.uid() = user_id);
create policy ai_rate_limits_update_own on public.ai_rate_limits for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy ai_rate_limits_delete_own on public.ai_rate_limits for delete using (auth.uid() = user_id);

revoke all on public.profiles, public.clients, public.jobs, public.invoices,
  public.expenses, public.services, public.inventory_items,
  public.mutation_receipts, public.ai_rate_limits from anon;
grant select, insert, update, delete on public.profiles, public.clients, public.jobs,
  public.invoices, public.expenses, public.services, public.inventory_items,
  public.mutation_receipts, public.ai_rate_limits to authenticated;

revoke execute on function public.is_jsonb_integer_in_range(jsonb, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.is_valid_invoice_line_items(jsonb) from public, anon, authenticated;
revoke execute on function public.bump_version_and_updated_at() from public, anon, authenticated;
