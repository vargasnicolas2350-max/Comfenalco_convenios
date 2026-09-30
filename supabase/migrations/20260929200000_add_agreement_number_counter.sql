create table if not exists public.agreement_number_counters (
  month_key text primary key check (month_key ~ '^\d{6}$'),
  last_number bigint not null check (last_number > 0)
);

alter table public.agreement_number_counters enable row level security;
revoke all on public.agreement_number_counters from public, anon, authenticated;
grant all on public.agreement_number_counters to service_role;

create or replace function public.next_agreement_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_month text := to_char(now() at time zone 'America/Bogota', 'YYYYMM');
  next_number bigint;
begin
  insert into public.agreement_number_counters (month_key, last_number)
  values (current_month, 1)
  on conflict (month_key) do update
    set last_number = public.agreement_number_counters.last_number + 1
  returning last_number into next_number;

  return 'CONV-' || current_month || '-' || lpad(next_number::text, 4, '0');
end;
$$;

revoke all on function public.next_agreement_code() from public, anon, authenticated;
grant execute on function public.next_agreement_code() to service_role;