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
