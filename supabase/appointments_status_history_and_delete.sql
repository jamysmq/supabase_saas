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
