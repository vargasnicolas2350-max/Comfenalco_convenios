create extension if not exists pgcrypto;

create or replace function public.profile_has_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.active
      and p.role = any(required_roles)
  );
$$;

revoke all on function public.profile_has_role(text[]) from public;
grant execute on function public.profile_has_role(text[]) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  nit text not null unique,
  razon_social text not null,
  ciudad text not null default '',
  unidad_regional text not null default '',
  correo text not null default '',
  nombre_contacto text not null default '',
  numero_contacto text not null default '',
  interventor text not null default '',
  camara_datos jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists companies_nit_digits_unique_idx
  on public.companies ((regexp_replace(nit, '[^0-9]', '', 'g')));

create table if not exists public.agreements (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  stage_number smallint not null default 1 check (stage_number between 1 and 5),
  responsible text not null default '',
  status text not null default 'Activa',
  stage_started_at timestamptz not null default now(),
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agreements_company_id_idx on public.agreements(company_id);
create index if not exists agreements_stage_started_at_idx on public.agreements(stage_started_at desc);
create index if not exists agreements_stage_number_idx on public.agreements(stage_number);

create table if not exists public.agreement_stage_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id text not null references public.agreements(id) on delete cascade,
  from_stage smallint check (from_stage between 1 and 5),
  to_stage smallint not null check (to_stage between 1 and 5),
  changed_by uuid references auth.users(id) on delete set null,
  actor_email text not null default '',
  notes text not null default '',
  changed_at timestamptz not null default now()
);

create index if not exists agreement_stage_events_agreement_idx
  on public.agreement_stage_events(agreement_id, changed_at desc);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  agreement_id text references public.agreements(id) on delete cascade,
  document_type text not null,
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  version integer not null default 1 check (version > 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  check (company_id is not null or agreement_id is not null)
);

create index if not exists documents_company_idx on public.documents(company_id);
create index if not exists documents_agreement_idx on public.documents(agreement_id);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  agreement_id text references public.agreements(id) on delete set null,
  recipient text not null,
  subject text not null,
  email_type text not null,
  status text not null check (status in ('accepted', 'failed')),
  provider_message_id text,
  error_summary text not null default '',
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_agreement_idx
  on public.email_logs(agreement_id, created_at desc);

drop trigger if exists companies_touch_updated_at on public.companies;
create trigger companies_touch_updated_at
before update on public.companies
for each row execute function public.touch_updated_at();

drop trigger if exists agreements_touch_updated_at on public.agreements;
create trigger agreements_touch_updated_at
before update on public.agreements
for each row execute function public.touch_updated_at();

create or replace function public.log_agreement_stage_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.agreement_stage_events (
      agreement_id, from_stage, to_stage, changed_by, actor_email, notes
    ) values (
      new.id, null, new.stage_number, auth.uid(),
      coalesce((select auth.jwt() ->> 'email'), ''), 'Convenio creado'
    );
  elsif old.stage_number is distinct from new.stage_number then
    insert into public.agreement_stage_events (
      agreement_id, from_stage, to_stage, changed_by, actor_email, notes
    ) values (
      new.id, old.stage_number, new.stage_number, auth.uid(),
      coalesce((select auth.jwt() ->> 'email'), ''), 'Cambio de etapa'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists agreements_log_stage_event on public.agreements;
create trigger agreements_log_stage_event
after insert or update of stage_number on public.agreements
for each row execute function public.log_agreement_stage_event();

alter table public.companies enable row level security;
alter table public.agreements enable row level security;
alter table public.agreement_stage_events enable row level security;
alter table public.documents enable row level security;
alter table public.email_logs enable row level security;

grant select on public.companies, public.agreements, public.agreement_stage_events, public.documents, public.email_logs to authenticated;
grant insert, update, delete on public.companies, public.agreements, public.documents to authenticated;

 drop policy if exists companies_read_active_profiles on public.companies;
create policy companies_read_active_profiles on public.companies
for select to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']));

drop policy if exists companies_manage_admin_editor on public.companies;
create policy companies_manage_admin_editor on public.companies
for all to authenticated
using (public.profile_has_role(array['admin', 'editor']))
with check (public.profile_has_role(array['admin', 'editor']));

drop policy if exists agreements_read_active_profiles on public.agreements;
create policy agreements_read_active_profiles on public.agreements
for select to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']));

drop policy if exists agreements_manage_admin_editor on public.agreements;
create policy agreements_manage_admin_editor on public.agreements
for all to authenticated
using (public.profile_has_role(array['admin', 'editor']))
with check (public.profile_has_role(array['admin', 'editor']));

drop policy if exists agreements_juridico_advance on public.agreements;
create policy agreements_juridico_advance on public.agreements
for update to authenticated
using (public.profile_has_role(array['juridico']) and stage_number = 2)
with check (public.profile_has_role(array['juridico']) and stage_number = 3);

drop policy if exists agreement_stage_events_read_active_profiles on public.agreement_stage_events;
create policy agreement_stage_events_read_active_profiles on public.agreement_stage_events
for select to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']));

drop policy if exists agreement_stage_events_insert_active_profiles on public.agreement_stage_events;

drop policy if exists documents_read_active_profiles on public.documents;
create policy documents_read_active_profiles on public.documents
for select to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']));

drop policy if exists documents_manage_active_profiles on public.documents;
create policy documents_manage_active_profiles on public.documents
for all to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']))
with check (public.profile_has_role(array['admin', 'editor', 'juridico']));

drop policy if exists email_logs_read_active_profiles on public.email_logs;
create policy email_logs_read_active_profiles on public.email_logs
for select to authenticated
using (public.profile_has_role(array['admin', 'editor', 'juridico']));

insert into storage.buckets (id, name, public, file_size_limit)
values ('convenio-documents', 'convenio-documents', false, 15728640)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists convenio_documents_read_active_profiles on storage.objects;
create policy convenio_documents_read_active_profiles on storage.objects
for select to authenticated
using (
  bucket_id = 'convenio-documents'
  and public.profile_has_role(array['admin', 'editor', 'juridico'])
);

drop policy if exists convenio_documents_upload_active_profiles on storage.objects;
create policy convenio_documents_upload_active_profiles on storage.objects
for insert to authenticated
with check (
  bucket_id = 'convenio-documents'
  and public.profile_has_role(array['admin', 'editor', 'juridico'])
);

drop policy if exists convenio_documents_update_active_profiles on storage.objects;
create policy convenio_documents_update_active_profiles on storage.objects
for update to authenticated
using (
  bucket_id = 'convenio-documents'
  and public.profile_has_role(array['admin', 'editor', 'juridico'])
)
with check (
  bucket_id = 'convenio-documents'
  and public.profile_has_role(array['admin', 'editor', 'juridico'])
);

drop policy if exists convenio_documents_delete_active_profiles on storage.objects;
create policy convenio_documents_delete_active_profiles on storage.objects
for delete to authenticated
using (
  bucket_id = 'convenio-documents'
  and public.profile_has_role(array['admin', 'editor', 'juridico'])
);
