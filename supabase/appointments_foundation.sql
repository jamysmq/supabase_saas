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
