-- Migration: 003_appointments_and_service_revenue.sql
-- Generated from existing loose SQL files. Keep source files until this is tested in staging.
-- Source files:
-- - supabase/appointments_foundation.sql
-- - supabase/appointments_external_customers.sql
-- - supabase/appointment_brazil_whatsapp_normalization.sql
-- - supabase/appointments_status_history_and_delete.sql
-- - supabase/appointment_history_query.sql
-- - supabase/appointment_history_snapshots.sql
-- - supabase/salon_service_revenue.sql


-- ============================================================
-- Source: supabase/appointments_foundation.sql
-- ============================================================

create table if not exists public.tenant_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  duration_minutes int4 not null default 60 check (duration_minutes > 0),
  price_cents int4 check (price_cents is null or price_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_services_tenant_active_idx
on public.tenant_services (tenant_id, is_active, name);

alter table public.tenant_services enable row level security;

create table if not exists public.tenant_staff_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  role text,
  phone_e164 text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_staff_members_tenant_active_idx
on public.tenant_staff_members (tenant_id, is_active, name);

alter table public.tenant_staff_members enable row level security;

alter table public.appointments
add column if not exists tenant_customer_id uuid references public.tenant_customers(id) on delete set null,
add column if not exists service_id uuid references public.tenant_services(id) on delete set null,
add column if not exists staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
add column if not exists title text,
add column if not exists notes text,
add column if not exists source text not null default 'panel',
add column if not exists updated_at timestamptz not null default now(),
add column if not exists cancelled_at timestamptz;

create index if not exists appointments_tenant_starts_idx
on public.appointments (tenant_id, starts_at);

create index if not exists appointments_tenant_customer_idx
on public.appointments (tenant_id, tenant_customer_id);

create index if not exists appointments_tenant_staff_idx
on public.appointments (tenant_id, staff_member_id, starts_at);

alter table public.appointments enable row level security;

create or replace function public.admin_list_appointments(
  p_tenant_id uuid,
  p_starts_from timestamptz,
  p_starts_to timestamptz
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  tenant_customer_id uuid,
  customer_name text,
  customer_phone_e164 text,
  service_id uuid,
  service_name text,
  staff_member_id uuid,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  title text,
  notes text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    a.tenant_customer_id,
    tc.full_name as customer_name,
    tc.phone_e164 as customer_phone_e164,
    a.service_id,
    s.name as service_name,
    a.staff_member_id,
    sm.name as staff_member_name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.title,
    a.notes,
    a.source
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.tenant_id = p_tenant_id
    and a.starts_at >= p_starts_from
    and a.starts_at < p_starts_to
  order by a.starts_at asc;
$$;

create or replace function public.admin_create_appointment(
  p_tenant_id uuid,
  p_tenant_customer_id uuid,
  p_service_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  if p_tenant_customer_id is not null and not exists (
    select 1 from public.tenant_customers
    where id = p_tenant_customer_id
      and tenant_id = p_tenant_id
      and is_active = true
  ) then
    raise exception 'customer_not_found';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.tenant_services
    where id = p_service_id
      and tenant_id = p_tenant_id
      and is_active = true
  ) then
    raise exception 'service_not_found';
  end if;

  if p_staff_member_id is not null and not exists (
    select 1 from public.tenant_staff_members
    where id = p_staff_member_id
      and tenant_id = p_tenant_id
      and is_active = true
  ) then
    raise exception 'staff_member_not_found';
  end if;

  insert into public.appointments (
    tenant_id,
    tenant_customer_id,
    service_id,
    staff_member_id,
    starts_at,
    ends_at,
    status,
    title,
    notes,
    source
  )
  values (
    p_tenant_id,
    p_tenant_customer_id,
    p_service_id,
    p_staff_member_id,
    p_starts_at,
    p_ends_at,
    'scheduled',
    nullif(trim(p_title), ''),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source), ''), 'panel')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

create or replace function public.admin_update_appointment_status(
  p_appointment_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid_appointment_status';
  end if;

  update public.appointments
  set status = p_status,
      cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
      updated_at = now()
  where id = p_appointment_id;
end;
$$;

grant execute on function public.admin_list_appointments(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_create_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text, text, text) to authenticated;
grant execute on function public.admin_update_appointment_status(uuid, text) to authenticated;


-- ============================================================
-- Source: supabase/appointments_external_customers.sql
-- ============================================================

create unique index if not exists end_customers_tenant_cpf_uidx
on public.end_customers (tenant_id, cpf)
where cpf is not null and cpf <> '';

create index if not exists end_customers_tenant_whatsapp_idx
on public.end_customers (tenant_id, whatsapp_e164);

create index if not exists appointments_tenant_end_customer_idx
on public.appointments (tenant_id, end_customer_id);

drop function if exists public.admin_list_appointments(uuid, timestamptz, timestamptz);

create or replace function public.admin_list_appointments(
  p_tenant_id uuid,
  p_starts_from timestamptz,
  p_starts_to timestamptz
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  tenant_customer_id uuid,
  end_customer_id uuid,
  customer_name text,
  customer_cpf text,
  customer_phone_e164 text,
  customer_birth_date date,
  service_id uuid,
  service_name text,
  staff_member_id uuid,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  title text,
  notes text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    a.tenant_customer_id,
    a.end_customer_id,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_cpf,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone_e164,
    ec.birth_date as customer_birth_date,
    a.service_id,
    s.name as service_name,
    a.staff_member_id,
    sm.name as staff_member_name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.title,
    a.notes,
    a.source
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.tenant_id = p_tenant_id
    and a.starts_at >= p_starts_from
    and a.starts_at < p_starts_to
  order by a.starts_at asc;
$$;

create or replace function public.admin_create_external_appointment(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_service_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end_customer_id uuid;
  v_appointment_id uuid;
  v_cpf text;
  v_whatsapp text;
begin
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_whatsapp := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');

  if nullif(trim(p_full_name), '') is null then
    raise exception 'customer_name_required';
  end if;

  if length(v_cpf) <> 11 then
    raise exception 'invalid_customer_cpf';
  end if;

  if length(v_whatsapp) not in (12, 13) or left(v_whatsapp, 2) <> '55' then
    raise exception 'invalid_customer_whatsapp';
  end if;

  if p_birth_date is null then
    raise exception 'customer_birth_date_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.tenant_services s
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and s.is_active = true
  ) then
    raise exception 'service_not_found';
  end if;

  if p_staff_member_id is not null and not exists (
    select 1 from public.tenant_staff_members sm
    where sm.id = p_staff_member_id
      and sm.tenant_id = p_tenant_id
      and sm.is_active = true
  ) then
    raise exception 'staff_member_not_found';
  end if;

  insert into public.end_customers (
    tenant_id,
    full_name,
    cpf,
    email,
    birth_date,
    whatsapp_e164,
    blocked
  )
  values (
    p_tenant_id,
    trim(p_full_name),
    v_cpf,
    '',
    p_birth_date,
    v_whatsapp,
    false
  )
  on conflict (tenant_id, cpf)
  where cpf is not null and cpf <> ''
  do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    whatsapp_e164 = excluded.whatsapp_e164,
    blocked = false
  returning id into v_end_customer_id;

  insert into public.appointments (
    tenant_id,
    end_customer_id,
    service_id,
    staff_member_id,
    starts_at,
    ends_at,
    status,
    title,
    notes,
    source
  )
  values (
    p_tenant_id,
    v_end_customer_id,
    p_service_id,
    p_staff_member_id,
    p_starts_at,
    p_ends_at,
    'scheduled',
    nullif(trim(p_title), ''),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source), ''), 'panel')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

grant execute on function public.admin_list_appointments(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_create_external_appointment(uuid, text, text, text, date, uuid, uuid, timestamptz, timestamptz, text, text, text) to authenticated;


-- ============================================================
-- Source: supabase/appointment_brazil_whatsapp_normalization.sql
-- ============================================================

create or replace function public.admin_create_external_appointment(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_service_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end_customer_id uuid;
  v_appointment_id uuid;
  v_cpf text;
  v_whatsapp text;
  v_service_name text;
  v_staff_member_name text;
begin
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_whatsapp := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');

  if length(v_whatsapp) in (10, 11) then
    v_whatsapp := '55' || v_whatsapp;
  end if;

  if nullif(trim(p_full_name), '') is null then
    raise exception 'customer_name_required';
  end if;

  if length(v_cpf) <> 11 then
    raise exception 'invalid_customer_cpf';
  end if;

  if length(v_whatsapp) not in (12, 13) or left(v_whatsapp, 2) <> '55' then
    raise exception 'invalid_customer_whatsapp';
  end if;

  if p_birth_date is null then
    raise exception 'customer_birth_date_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  if p_service_id is not null then
    select s.name
      into v_service_name
    from public.tenant_services s
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and s.is_active = true;

    if v_service_name is null then
      raise exception 'service_not_found';
    end if;
  end if;

  if p_staff_member_id is not null then
    select sm.name
      into v_staff_member_name
    from public.tenant_staff_members sm
    where sm.id = p_staff_member_id
      and sm.tenant_id = p_tenant_id
      and sm.is_active = true;

    if v_staff_member_name is null then
      raise exception 'staff_member_not_found';
    end if;
  end if;

  insert into public.end_customers (
    tenant_id,
    full_name,
    cpf,
    email,
    birth_date,
    whatsapp_e164,
    blocked
  )
  values (
    p_tenant_id,
    trim(p_full_name),
    v_cpf,
    '',
    p_birth_date,
    v_whatsapp,
    false
  )
  on conflict (tenant_id, cpf)
  where cpf is not null and cpf <> ''
  do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    whatsapp_e164 = excluded.whatsapp_e164,
    blocked = false
  returning id into v_end_customer_id;

  insert into public.appointments (
    tenant_id,
    end_customer_id,
    service_id,
    service_name_snapshot,
    staff_member_id,
    staff_member_name_snapshot,
    starts_at,
    ends_at,
    status,
    title,
    notes,
    source
  )
  values (
    p_tenant_id,
    v_end_customer_id,
    p_service_id,
    v_service_name,
    p_staff_member_id,
    v_staff_member_name,
    p_starts_at,
    p_ends_at,
    'scheduled',
    nullif(trim(p_title), ''),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source), ''), 'panel')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

grant execute on function public.admin_create_external_appointment(uuid, text, text, text, date, uuid, uuid, timestamptz, timestamptz, text, text, text) to authenticated;


-- ============================================================
-- Source: supabase/appointments_status_history_and_delete.sql
-- ============================================================

alter table public.appointments
add column if not exists deleted_at timestamptz;

alter table public.appointments
drop constraint if exists appointments_status_check;

alter table public.appointments
add constraint appointments_status_check
check (status in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'));

create table if not exists public.appointment_status_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_user_id uuid references public.tenant_users(id) on delete set null,
  old_status text,
  new_status text not null,
  source text not null default 'panel',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists appointment_status_events_appointment_created_idx
on public.appointment_status_events (appointment_id, created_at desc);

create index if not exists appointment_status_events_tenant_created_idx
on public.appointment_status_events (tenant_id, created_at desc);

alter table public.appointment_status_events enable row level security;

grant select
on public.appointment_status_events
to authenticated;

grant select, insert, update, delete
on public.appointment_status_events
to service_role;

drop policy if exists "appointment_status_events_read_own_tenant" on public.appointment_status_events;
create policy "appointment_status_events_read_own_tenant"
on public.appointment_status_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = appointment_status_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop function if exists public.admin_list_appointments(uuid, timestamptz, timestamptz);

create or replace function public.admin_list_appointments(
  p_tenant_id uuid,
  p_starts_from timestamptz,
  p_starts_to timestamptz
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  tenant_customer_id uuid,
  end_customer_id uuid,
  customer_name text,
  customer_cpf text,
  customer_phone_e164 text,
  customer_birth_date date,
  service_id uuid,
  service_name text,
  staff_member_id uuid,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  title text,
  notes text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    a.tenant_customer_id,
    a.end_customer_id,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_cpf,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone_e164,
    ec.birth_date as customer_birth_date,
    a.service_id,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    a.staff_member_id,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.title,
    a.notes,
    a.source
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.tenant_id = p_tenant_id
    and a.starts_at >= p_starts_from
    and a.starts_at < p_starts_to
    and a.deleted_at is null
  order by a.starts_at asc;
$$;

grant execute on function public.admin_list_appointments(uuid, timestamptz, timestamptz) to authenticated;


-- ============================================================
-- Source: supabase/appointment_history_query.sql
-- ============================================================

drop function if exists public.admin_list_appointment_history(uuid, timestamptz, timestamptz, text);

create or replace function public.admin_list_appointment_history(
  p_tenant_id uuid,
  p_starts_from timestamptz,
  p_starts_to timestamptz,
  p_status text default null
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  customer_name text,
  customer_cpf text,
  customer_phone_e164 text,
  customer_birth_date date,
  service_name text,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  title text,
  notes text,
  source text,
  deleted_at timestamptz,
  latest_status_old text,
  latest_status_new text,
  latest_status_source text,
  latest_status_note text,
  latest_status_changed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_cpf,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone_e164,
    ec.birth_date as customer_birth_date,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.title,
    a.notes,
    a.source,
    a.deleted_at,
    latest_event.old_status as latest_status_old,
    latest_event.new_status as latest_status_new,
    latest_event.source as latest_status_source,
    latest_event.note as latest_status_note,
    latest_event.created_at as latest_status_changed_at
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  left join lateral (
    select ase.old_status, ase.new_status, ase.source, ase.note, ase.created_at
    from public.appointment_status_events ase
    where ase.appointment_id = a.id
      and ase.tenant_id = a.tenant_id
    order by ase.created_at desc
    limit 1
  ) latest_event on true
  where a.tenant_id = p_tenant_id
    and a.starts_at >= p_starts_from
    and a.starts_at < p_starts_to
    and (
      p_status is null
      or p_status = ''
      or a.status = p_status
      or (p_status = 'deleted' and a.deleted_at is not null)
    )
  order by a.starts_at desc;
$$;

grant execute on function public.admin_list_appointment_history(uuid, timestamptz, timestamptz, text) to authenticated;


-- ============================================================
-- Source: supabase/appointment_history_snapshots.sql
-- ============================================================

alter table public.appointments
add column if not exists service_name_snapshot text,
add column if not exists staff_member_name_snapshot text;

update public.appointments a
set service_name_snapshot = s.name
from public.tenant_services s
where a.service_id = s.id
  and a.service_name_snapshot is null;

update public.appointments a
set staff_member_name_snapshot = sm.name
from public.tenant_staff_members sm
where a.staff_member_id = sm.id
  and a.staff_member_name_snapshot is null;

drop function if exists public.admin_list_appointments(uuid, timestamptz, timestamptz);

create or replace function public.admin_list_appointments(
  p_tenant_id uuid,
  p_starts_from timestamptz,
  p_starts_to timestamptz
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  tenant_customer_id uuid,
  end_customer_id uuid,
  customer_name text,
  customer_cpf text,
  customer_phone_e164 text,
  customer_birth_date date,
  service_id uuid,
  service_name text,
  staff_member_id uuid,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text,
  title text,
  notes text,
  source text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    a.tenant_customer_id,
    a.end_customer_id,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_cpf,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone_e164,
    ec.birth_date as customer_birth_date,
    a.service_id,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    a.staff_member_id,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    a.starts_at,
    a.ends_at,
    a.status,
    a.title,
    a.notes,
    a.source
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.tenant_id = p_tenant_id
    and a.starts_at >= p_starts_from
    and a.starts_at < p_starts_to
  order by a.starts_at asc;
$$;

create or replace function public.admin_create_external_appointment(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_service_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end_customer_id uuid;
  v_appointment_id uuid;
  v_cpf text;
  v_whatsapp text;
  v_service_name text;
  v_staff_member_name text;
begin
  v_cpf := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_whatsapp := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');

  if nullif(trim(p_full_name), '') is null then
    raise exception 'customer_name_required';
  end if;

  if length(v_cpf) <> 11 then
    raise exception 'invalid_customer_cpf';
  end if;

  if length(v_whatsapp) not in (12, 13) or left(v_whatsapp, 2) <> '55' then
    raise exception 'invalid_customer_whatsapp';
  end if;

  if p_birth_date is null then
    raise exception 'customer_birth_date_required';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  if p_service_id is not null then
    select s.name
      into v_service_name
    from public.tenant_services s
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and s.is_active = true;

    if v_service_name is null then
      raise exception 'service_not_found';
    end if;
  end if;

  if p_staff_member_id is not null then
    select sm.name
      into v_staff_member_name
    from public.tenant_staff_members sm
    where sm.id = p_staff_member_id
      and sm.tenant_id = p_tenant_id
      and sm.is_active = true;

    if v_staff_member_name is null then
      raise exception 'staff_member_not_found';
    end if;
  end if;

  insert into public.end_customers (
    tenant_id,
    full_name,
    cpf,
    email,
    birth_date,
    whatsapp_e164,
    blocked
  )
  values (
    p_tenant_id,
    trim(p_full_name),
    v_cpf,
    '',
    p_birth_date,
    v_whatsapp,
    false
  )
  on conflict (tenant_id, cpf)
  where cpf is not null and cpf <> ''
  do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    whatsapp_e164 = excluded.whatsapp_e164,
    blocked = false
  returning id into v_end_customer_id;

  insert into public.appointments (
    tenant_id,
    end_customer_id,
    service_id,
    service_name_snapshot,
    staff_member_id,
    staff_member_name_snapshot,
    starts_at,
    ends_at,
    status,
    title,
    notes,
    source
  )
  values (
    p_tenant_id,
    v_end_customer_id,
    p_service_id,
    v_service_name,
    p_staff_member_id,
    v_staff_member_name,
    p_starts_at,
    p_ends_at,
    'scheduled',
    nullif(trim(p_title), ''),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source), ''), 'panel')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

grant execute on function public.admin_list_appointments(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.admin_create_external_appointment(uuid, text, text, text, date, uuid, uuid, timestamptz, timestamptz, text, text, text) to authenticated;


-- ============================================================
-- Source: supabase/salon_service_revenue.sql
-- ============================================================

create table if not exists public.tenant_service_revenue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid references public.tenant_services(id) on delete set null,
  staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  customer_name_snapshot text,
  customer_document_snapshot text,
  customer_phone_snapshot text,
  service_name_snapshot text,
  staff_member_name_snapshot text,
  amount_cents integer not null default 0,
  currency text not null default 'BRL',
  status text not null default 'recognized',
  source text not null default 'system',
  recognized_at timestamptz not null default now(),
  voided_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_service_revenue_events
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists service_id uuid references public.tenant_services(id) on delete set null,
  add column if not exists staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_document_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists service_name_snapshot text,
  add column if not exists staff_member_name_snapshot text,
  add column if not exists amount_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists status text not null default 'recognized',
  add column if not exists source text not null default 'system',
  add column if not exists recognized_at timestamptz not null default now(),
  add column if not exists voided_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tenant_service_revenue_events_appointment_uidx
on public.tenant_service_revenue_events (appointment_id);

create index if not exists tenant_service_revenue_events_tenant_recognized_idx
on public.tenant_service_revenue_events (tenant_id, recognized_at desc);

alter table public.tenant_service_revenue_events enable row level security;

grant select
on public.tenant_service_revenue_events
to authenticated;

grant select, insert, update, delete
on public.tenant_service_revenue_events
to service_role;

drop policy if exists "tenant_service_revenue_events_read_own_tenant" on public.tenant_service_revenue_events;
create policy "tenant_service_revenue_events_read_own_tenant"
on public.tenant_service_revenue_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_service_revenue_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

create or replace function public.admin_sync_appointment_service_revenue(
  p_appointment_id uuid,
  p_source text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_event_id uuid;
begin
  select
    a.id as appointment_id,
    a.tenant_id,
    a.service_id,
    a.staff_member_id,
    a.status as appointment_status,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_document,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    coalesce(s.price_cents, 0) as amount_cents,
    t.business_type
    into v_row
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.id = p_appointment_id
    and a.deleted_at is null;

  if v_row.appointment_id is null then
    raise exception 'appointment_not_found';
  end if;

  if v_row.business_type <> 'salon' then
    return null;
  end if;

  if v_row.appointment_status = 'confirmed' and v_row.amount_cents > 0 then
    insert into public.tenant_service_revenue_events (
      tenant_id,
      appointment_id,
      service_id,
      staff_member_id,
      customer_name_snapshot,
      customer_document_snapshot,
      customer_phone_snapshot,
      service_name_snapshot,
      staff_member_name_snapshot,
      amount_cents,
      status,
      source,
      recognized_at,
      voided_at,
      payload
    )
    values (
      v_row.tenant_id,
      v_row.appointment_id,
      v_row.service_id,
      v_row.staff_member_id,
      v_row.customer_name,
      v_row.customer_document,
      v_row.customer_phone,
      v_row.service_name,
      v_row.staff_member_name,
      v_row.amount_cents,
      'recognized',
      coalesce(nullif(trim(p_source), ''), 'system'),
      now(),
      null,
      jsonb_build_object('appointment_status', v_row.appointment_status)
    )
    on conflict (appointment_id)
    do update set
      service_id = excluded.service_id,
      staff_member_id = excluded.staff_member_id,
      customer_name_snapshot = excluded.customer_name_snapshot,
      customer_document_snapshot = excluded.customer_document_snapshot,
      customer_phone_snapshot = excluded.customer_phone_snapshot,
      service_name_snapshot = excluded.service_name_snapshot,
      staff_member_name_snapshot = excluded.staff_member_name_snapshot,
      amount_cents = excluded.amount_cents,
      status = 'recognized',
      source = excluded.source,
      voided_at = null,
      payload = excluded.payload,
      updated_at = now()
    returning id into v_event_id;

    return v_event_id;
  end if;

  update public.tenant_service_revenue_events
  set
    status = 'voided',
    voided_at = coalesce(voided_at, now()),
    source = coalesce(nullif(trim(p_source), ''), source),
    updated_at = now(),
    payload = jsonb_build_object('appointment_status', v_row.appointment_status)
  where appointment_id = p_appointment_id
    and status = 'recognized'
  returning id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.admin_sync_appointment_service_revenue(uuid, text) to authenticated, service_role;

