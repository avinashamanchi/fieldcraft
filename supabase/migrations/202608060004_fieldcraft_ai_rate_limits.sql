create table public.ai_rate_limit_scopes (
  scope_digest text not null check (scope_digest ~ '^[0-9a-f]{64}$'),
  route text not null check (route in ('invoice.parse.v1', 'expense.categorize.v1', 'message.draft.v1')),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count between 1 and 10000),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (scope_digest, route, window_started_at)
);

alter table public.ai_rate_limit_scopes enable row level security;
revoke all on public.ai_rate_limit_scopes from public, anon, authenticated;

create or replace function public.consume_fieldcraft_ai_rate_limit(
  p_scope_digest text,
  p_route text,
  p_limit integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_count integer;
begin
  if p_scope_digest !~ '^[0-9a-f]{64}$'
    or p_route not in ('invoice.parse.v1', 'expense.categorize.v1', 'message.draft.v1')
    or p_limit not between 1 and 1000
  then
    raise exception 'invalid AI rate-limit contract' using errcode = '22023';
  end if;

  insert into public.ai_rate_limit_scopes as ledger (
    scope_digest, route, window_started_at, request_count
  ) values (
    p_scope_digest, p_route, v_window, 1
  )
  on conflict (scope_digest, route, window_started_at) do update
  set request_count = ledger.request_count + 1,
      updated_at = clock_timestamp()
  returning request_count into v_count;

  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_window + interval '60 seconds' - clock_timestamp())))::integer) end;
end;
$$;

revoke execute on function public.consume_fieldcraft_ai_rate_limit(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_fieldcraft_ai_rate_limit(text, text, integer)
  to service_role;
