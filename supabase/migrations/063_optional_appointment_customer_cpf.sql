create or replace function public.upsert_external_appointment_customer(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end_customer_id uuid;
  v_cpf_input text := nullif(trim(coalesce(p_cpf, '')), '');
  v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');
begin
  if length(v_whatsapp) in (10, 11) then
    v_whatsapp := '55' || v_whatsapp;
  end if;

  if nullif(trim(p_full_name), '') is null then
    raise exception 'customer_name_required';
  end if;

  if v_cpf_input is not null and (v_cpf is null or length(v_cpf) <> 11) then
    raise exception 'invalid_customer_cpf';
  end if;

  if length(v_whatsapp) not in (12, 13) or left(v_whatsapp, 2) <> '55' then
    raise exception 'invalid_customer_whatsapp';
  end if;

  if p_birth_date is null then
    raise exception 'customer_birth_date_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':' || coalesce(v_cpf, v_whatsapp || ':' || p_birth_date::text),
      0
    )
  );

  if v_cpf is not null then
    select customer.id
      into v_end_customer_id
    from public.end_customers customer
    where customer.tenant_id = p_tenant_id
      and customer.cpf = v_cpf
    limit 1;
  end if;

  if v_end_customer_id is null then
    select customer.id
      into v_end_customer_id
    from public.end_customers customer
    where customer.tenant_id = p_tenant_id
      and customer.whatsapp_e164 = v_whatsapp
      and customer.birth_date = p_birth_date
      and lower(trim(customer.full_name)) = lower(trim(p_full_name))
    order by
      case when nullif(customer.cpf, '') is not null then 0 else 1 end,
      customer.id
    limit 1;
  end if;

  if v_end_customer_id is null then
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
      coalesce(v_cpf, ''),
      '',
      p_birth_date,
      v_whatsapp,
      false
    )
    returning id into v_end_customer_id;
  else
    update public.end_customers
    set full_name = trim(p_full_name),
        cpf = coalesce(v_cpf, nullif(cpf, ''), ''),
        birth_date = p_birth_date,
        whatsapp_e164 = v_whatsapp,
        blocked = false
    where id = v_end_customer_id;
  end if;

  return v_end_customer_id;
end;
$$;

revoke all on function public.upsert_external_appointment_customer(
  uuid, text, text, text, date
) from public, anon, authenticated;

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
  v_service_name text;
  v_staff_member_name text;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  if p_service_id is not null then
    select service.name
      into v_service_name
    from public.tenant_services service
    where service.id = p_service_id
      and service.tenant_id = p_tenant_id
      and service.is_active = true;

    if v_service_name is null then
      raise exception 'service_not_found';
    end if;
  end if;

  if p_staff_member_id is not null then
    select staff.name
      into v_staff_member_name
    from public.tenant_staff_members staff
    where staff.id = p_staff_member_id
      and staff.tenant_id = p_tenant_id
      and staff.is_active = true;

    if v_staff_member_name is null then
      raise exception 'staff_member_not_found';
    end if;
  end if;

  v_end_customer_id := public.upsert_external_appointment_customer(
    p_tenant_id,
    p_full_name,
    p_cpf,
    p_whatsapp_e164,
    p_birth_date
  );

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

create or replace function public.admin_create_external_resource_appointment(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_bookable_resource_id uuid,
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
  v_resource_name text;
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  select resource.name
    into v_resource_name
  from public.tenant_bookable_resources resource
  join public.tenants tenant on tenant.id = resource.tenant_id
  where resource.id = p_bookable_resource_id
    and resource.tenant_id = p_tenant_id
    and resource.is_active = true
    and tenant.status = 'active'
    and tenant.plan = 'plan3'
    and tenant.resource_booking_plus_enabled = true;

  if v_resource_name is null then
    raise exception 'bookable_resource_not_found_or_plus_disabled';
  end if;

  v_end_customer_id := public.upsert_external_appointment_customer(
    p_tenant_id,
    p_full_name,
    p_cpf,
    p_whatsapp_e164,
    p_birth_date
  );

  insert into public.appointments (
    tenant_id,
    end_customer_id,
    bookable_resource_id,
    bookable_resource_name_snapshot,
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
    p_bookable_resource_id,
    v_resource_name,
    p_starts_at,
    p_ends_at,
    'scheduled',
    coalesce(nullif(trim(p_title), ''), 'Aluguel de ' || v_resource_name),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_source), ''), 'panel')
  )
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

revoke all on function public.admin_create_external_resource_appointment(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text, text
) from public, anon;

grant execute on function public.admin_create_external_resource_appointment(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text, text
) to authenticated, service_role;

-- Conversations paused at the former CPF-first step continue from birth date.
-- The new workflow will ask for the optional CPF again only after slot selection.
update public.wa_conversations
set step = 'collect_birth_date',
    payload_draft = coalesce(payload_draft, '{}'::jsonb) #- '{appointment,cpf}'
where closed = false
  and step = 'collect_cpf'
  and payload_draft ->> 'module' = 'appointments';
