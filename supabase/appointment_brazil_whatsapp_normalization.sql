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
