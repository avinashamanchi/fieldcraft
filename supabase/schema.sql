-- FieldCraft Supabase Schema
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── PROFILES table (linked to auth.users) ────────────────────────────────────
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null default '',
  business_name text not null default '',
  trade_type text not null default 'General',
  phone text,
  email text,
  address text,
  license_number text,
  hourly_rate numeric not null default 95,
  tax_rate numeric not null default 0.08,
  payment_terms text,
  logo_data_url text,
  onboarding_complete boolean not null default false,
  has_seen_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Users can manage their own profile" on public.profiles;
create policy "Users can manage their own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ─── JOBS table ───────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  title text not null default '',
  client_name text not null default '',
  client_id uuid,
  address text not null default '',
  trade_type text not null default 'General',
  status text not null default 'Quoted',
  notes text not null default '',
  labor_hours numeric not null default 0,
  labor_rate numeric not null default 95,
  invoice_id uuid,
  invoice_total numeric,
  expense_ids jsonb not null default '[]',
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.jobs enable row level security;
drop policy if exists "Users can manage their own jobs" on public.jobs;
create policy "Users can manage their own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── INVOICES table ───────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  job_id uuid,
  number text not null,
  client_name text not null default '',
  line_items jsonb not null default '[]',
  subtotal numeric not null default 0,
  tax_rate numeric not null default 0.08,
  tax_amount numeric not null default 0,
  total numeric not null default 0,
  labor_rate numeric not null default 95,
  notes text,
  payment_terms text not null default 'Due on Receipt',
  payment_status text not null default 'Draft',
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.invoices enable row level security;
drop policy if exists "Users can manage their own invoices" on public.invoices;
create policy "Users can manage their own invoices" on public.invoices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── CLIENTS table ────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null default '',
  phone text,
  email text,
  address text,
  city text,
  state text,
  zip text,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.clients enable row level security;
drop policy if exists "Users can manage their own clients" on public.clients;
create policy "Users can manage their own clients" on public.clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── EXPENSES table ───────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  vendor text not null default '',
  amount numeric not null default 0,
  category text not null default 'Other',
  date text not null,
  notes text,
  receipt_uri text,
  job_id uuid,
  created_at timestamptz not null default now()
);
alter table public.expenses enable row level security;
drop policy if exists "Users can manage their own expenses" on public.expenses;
create policy "Users can manage their own expenses" on public.expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── SERVICES table ───────────────────────────────────────────────────────────
create table if not exists public.services (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null default '',
  description text not null default '',
  estimated_hours numeric not null default 0,
  default_price numeric not null default 0,
  category text,
  created_at timestamptz not null default now()
);
alter table public.services enable row level security;
drop policy if exists "Users can manage their own services" on public.services;
create policy "Users can manage their own services" on public.services
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Auto-create profile on signup ───────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, business_name)
  values (new.id, '', '')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
