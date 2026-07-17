-- Applies an appointment outcome, its audit event and salon revenue in one
-- database transaction so a completed service cannot disappear from the queue
-- without reaching the financial history.

create or replace function public.admin_update_appointment_outcome(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_tenant_user_id uuid,
  p_status text,
  p_source text default 'panel'
)
returns table (
  appointment_id uuid,
  appointment_status text,
  status_event_id uuid,
  revenue_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_status_event_id uuid;
  v_revenue_event_id uuid;
begin
  if p_status not in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid_appointment_status';
  end if;

  if not exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.id = p_tenant_user_id
      and tenant_user.tenant_id = p_tenant_id
  ) then
    raise exception 'tenant_user_not_allowed';
  end if;

  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and appointment.tenant_id = p_tenant_id
    and appointment.deleted_at is null
  for update;

  if v_appointment.id is null then
    raise exception 'appointment_not_found';
  end if;

  if p_status = 'completed' and v_appointment.ends_at > now() then
    raise exception 'appointment_has_not_ended';
  end if;

  if v_appointment.status is distinct from p_status then
    update public.appointments
    set status = p_status,
        cancelled_at = case when p_status = 'cancelled' then now() else null end,
        updated_at = now()
    where id = v_appointment.id;

    insert into public.appointment_status_events (
      appointment_id,
      tenant_id,
      tenant_user_id,
      old_status,
      new_status,
      source
    ) values (
      v_appointment.id,
      p_tenant_id,
      p_tenant_user_id,
      v_appointment.status,
      p_status,
      coalesce(nullif(trim(p_source), ''), 'panel')
    )
    returning id into v_status_event_id;

    v_revenue_event_id := public.admin_sync_appointment_service_revenue(
      v_appointment.id,
      coalesce(nullif(trim(p_source), ''), 'panel')
    );
  end if;

  appointment_id := v_appointment.id;
  appointment_status := p_status;
  status_event_id := v_status_event_id;
  revenue_event_id := v_revenue_event_id;
  return next;
end;
$$;

revoke all on function public.admin_update_appointment_outcome(uuid, uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_update_appointment_outcome(uuid, uuid, uuid, text, text)
to service_role;

-- The slot RPC is consumed only by the official n8n workflow. Older
-- migrations left authenticated access on both the public wrapper and its
-- base function, which allowed a caller to provide another tenant id.
revoke all on function public.wa_appointment_suggest_slots(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.wa_appointment_suggest_slots(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) to service_role;

revoke all on function public.wa_appointment_suggest_slots_base(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.wa_appointment_suggest_slots_base(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) to service_role;

revoke all on function public.prevent_appointment_outside_working_days()
from public, anon, authenticated;

-- Reassert the trigger function restriction after migration 046 replaced its
-- body. CREATE OR REPLACE normally preserves privileges, but keeping the rule
-- here makes the final schema explicit and independently auditable.
revoke all on function public.sync_platform_plan_price_to_tenants()
from public, anon, authenticated;
