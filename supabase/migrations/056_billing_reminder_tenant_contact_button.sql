-- Adds versioned billing-reminder RPCs for templates with a dynamic tenant wa.me
-- button. Existing RPCs remain available during rollout.

create or replace function public.admin_list_due_cycles_for_date_v2(
  p_run_date date default current_date
)
returns table (
  billing_cycle_id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_whatsapp_e164 text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  due_date date,
  amount_cents integer,
  currency text,
  pix_key text,
  pix_beneficiary_name text,
  template_content text,
  notification_type text,
  template_name text,
  attempt_number integer
)
language sql
security definer
set search_path = public
as $$
  select
    source.billing_cycle_id,
    source.tenant_id,
    source.tenant_name,
    regexp_replace(coalesce(tenant.whatsapp_e164, ''), '\D', '', 'g'),
    source.customer_id,
    source.customer_name,
    source.customer_phone,
    source.due_date,
    source.amount_cents,
    source.currency,
    source.pix_key,
    source.pix_beneficiary_name,
    source.template_content,
    source.notification_type,
    case
      when length(regexp_replace(coalesce(tenant.whatsapp_e164, ''), '\D', '', 'g')) between 10 and 15
        and source.notification_type = 'due_today'
        then 'jack_billing_due_reminder_v4'
      when length(regexp_replace(coalesce(tenant.whatsapp_e164, ''), '\D', '', 'g')) between 10 and 15
        and source.notification_type = 'overdue'
        then 'jack_billing_overdue_reminder_v3'
      else source.template_name
    end,
    source.attempt_number
  from public.admin_list_due_cycles_for_date(p_run_date) source
  join public.tenants tenant on tenant.id = source.tenant_id;
$$;

create or replace function public.admin_reserve_billing_reminder_attempt_v2(
  p_billing_cycle_id uuid,
  p_recipient_e164 text,
  p_rendered_message text,
  p_notification_type text,
  p_template_name text,
  p_attempt_date date default (now() at time zone 'America/Fortaleza')::date
)
returns table (
  reminder_event_id uuid,
  billing_cycle_id uuid,
  attempt_number integer,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved record;
  v_compatible_template_name text;
begin
  v_compatible_template_name := case trim(coalesce(p_template_name, ''))
    when 'jack_billing_due_reminder_v4' then 'jack_billing_due_reminder_v3'
    when 'jack_billing_overdue_reminder_v3' then 'jack_billing_overdue_reminder_v2'
    else trim(coalesce(p_template_name, ''))
  end;

  select reserved.*
  into v_reserved
  from public.admin_reserve_billing_reminder_attempt(
    p_billing_cycle_id,
    p_recipient_e164,
    p_rendered_message,
    p_notification_type,
    v_compatible_template_name,
    p_attempt_date
  ) reserved;

  if v_reserved.reminder_event_id is null then
    return;
  end if;

  update public.billing_reminder_events event
  set template_name = trim(p_template_name)
  where event.id = v_reserved.reminder_event_id;

  reminder_event_id := v_reserved.reminder_event_id;
  billing_cycle_id := v_reserved.billing_cycle_id;
  attempt_number := v_reserved.attempt_number;
  delivery_status := v_reserved.delivery_status;
  return next;
end;
$$;

revoke all on function public.admin_list_due_cycles_for_date_v2(date)
from public, anon, authenticated;
grant execute on function public.admin_list_due_cycles_for_date_v2(date)
to service_role;

revoke all on function public.admin_reserve_billing_reminder_attempt_v2(
  uuid, text, text, text, text, date
) from public, anon, authenticated;
grant execute on function public.admin_reserve_billing_reminder_attempt_v2(
  uuid, text, text, text, text, date
) to service_role;

do $validation$
declare
  v_list_definition text;
  v_reserve_definition text;
begin
  select pg_get_functiondef(
    'public.admin_list_due_cycles_for_date_v2(date)'::regprocedure
  ) into v_list_definition;
  select pg_get_functiondef(
    'public.admin_reserve_billing_reminder_attempt_v2(uuid,text,text,text,text,date)'::regprocedure
  ) into v_reserve_definition;

  if v_list_definition not like '%tenant_whatsapp_e164%'
     or v_list_definition not like '%jack_billing_due_reminder_v4%'
     or v_list_definition not like '%jack_billing_overdue_reminder_v3%' then
    raise exception 'billing_contact_button_list_rpc_validation_failed';
  end if;

  if v_reserve_definition not like '%jack_billing_due_reminder_v4%'
     or v_reserve_definition not like '%jack_billing_overdue_reminder_v3%' then
    raise exception 'billing_contact_button_reserve_rpc_validation_failed';
  end if;
end
$validation$;
