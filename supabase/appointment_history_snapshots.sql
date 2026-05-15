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
