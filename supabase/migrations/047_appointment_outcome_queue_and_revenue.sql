-- Recognizes salon service revenue only after the appointment has ended and
-- the tenant explicitly marks the service as completed.

create index if not exists appointments_tenant_outcome_queue_idx
on public.appointments(tenant_id, status, ends_at)
where deleted_at is null
  and status in ('scheduled', 'confirmed');

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
    a.ends_at,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_document,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    coalesce(s.price_cents, 0) as amount_cents,
    t.business_type,
    coalesce((
      select max(status_event.created_at)
      from public.appointment_status_events status_event
      where status_event.appointment_id = a.id
        and status_event.new_status = 'completed'
    ), a.ends_at, now()) as completed_at
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

  if v_row.appointment_status = 'completed'
     and v_row.ends_at <= now()
     and v_row.amount_cents > 0 then
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
      v_row.completed_at,
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
      recognized_at = excluded.recognized_at,
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

create or replace function public.admin_list_appointment_outcome_queue(
  p_tenant_id uuid,
  p_now timestamptz default now()
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
    a.id,
    a.tenant_id,
    a.tenant_customer_id,
    a.end_customer_id,
    coalesce(tc.full_name, ec.full_name),
    coalesce(tc.cpf, ec.cpf),
    coalesce(tc.phone_e164, ec.whatsapp_e164),
    ec.birth_date,
    a.service_id,
    coalesce(a.service_name_snapshot, s.name),
    a.staff_member_id,
    coalesce(a.staff_member_name_snapshot, sm.name),
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
    and a.deleted_at is null
    and a.status in ('scheduled', 'confirmed')
    and a.ends_at <= p_now
  order by a.ends_at asc
  limit 100;
$$;

revoke all on function public.admin_sync_appointment_service_revenue(uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_sync_appointment_service_revenue(uuid, text)
to service_role;

revoke all on function public.admin_list_appointment_outcome_queue(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function public.admin_list_appointment_outcome_queue(uuid, timestamptz)
to service_role;

-- Repair revenue created by the former confirmed-status rule.
update public.tenant_service_revenue_events revenue
set status = 'voided',
    voided_at = coalesce(revenue.voided_at, now()),
    source = 'migration_047',
    payload = jsonb_build_object('appointment_status', appointment.status),
    updated_at = now()
from public.appointments appointment
where appointment.id = revenue.appointment_id
  and appointment.status <> 'completed'
  and revenue.status = 'recognized';

do $$
declare
  v_appointment_id uuid;
begin
  for v_appointment_id in
    select appointment.id
    from public.appointments appointment
    join public.tenants tenant on tenant.id = appointment.tenant_id
    where tenant.business_type = 'salon'
      and appointment.deleted_at is null
      and appointment.status = 'completed'
      and appointment.ends_at <= now()
  loop
    perform public.admin_sync_appointment_service_revenue(
      v_appointment_id,
      'migration_047'
    );
  end loop;
end;
$$;

