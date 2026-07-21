-- Makes confirmation and reminder notifications generic for service and
-- resource appointments while preserving the existing Meta templates.

update public.tenant_message_templates
set content = 'Olá, {{customer_name}}! Seu agendamento em {{tenant_name}} está marcado para {{appointment_date}}, às {{appointment_time}}. Agendamento: {{service_name}}. Use os botões abaixo para confirmar, remarcar ou cancelar.',
    updated_at = now()
where template_key = 'appointment_confirmation_reminder'
  and channel = 'whatsapp';

update public.tenant_message_templates
set content = 'Olá, {{customer_name}}! Passando para lembrar que seu horário em {{tenant_name}} é hoje, às {{appointment_time}}. Agendamento: {{service_name}}. Até já! 😊',
    updated_at = now()
where template_key = 'appointment_one_hour_reminder'
  and channel = 'whatsapp';

create or replace function public.wa_appointment_list_due_notifications(
  p_now timestamptz default now(),
  p_timezone text default 'America/Fortaleza'
)
returns table (
  appointment_id uuid, tenant_id uuid, tenant_name text, customer_name text,
  customer_phone_e164 text, service_name text, staff_member_name text,
  starts_at timestamptz, ends_at timestamptz, appointment_date text,
  appointment_time text, notification_type text, reminder_key text,
  message_template text
)
language sql
security definer
set search_path = public
as $$
  with appointment_data as (
    select a.id appointment_id, a.tenant_id,
      coalesce(nullif(trim(t.public_name), ''), t.legal_name) tenant_name,
      coalesce(tc.full_name, ec.full_name) customer_name,
      regexp_replace(coalesce(tc.phone_e164, ec.whatsapp_e164, ''), '\D', '', 'g') customer_phone_e164,
      coalesce(
        nullif(trim(a.service_name_snapshot), ''),
        s.name,
        nullif(trim(a.bookable_resource_name_snapshot), ''),
        resource.name,
        'Agendamento'
      ) service_name,
      coalesce(a.staff_member_name_snapshot, sm.name) staff_member_name,
      a.starts_at, a.ends_at, a.created_at, a.status,
      a.starts_at at time zone p_timezone local_start,
      p_now at time zone p_timezone local_now,
      confirmation_template.content confirmation_template,
      one_hour_template.content one_hour_template
    from public.appointments a
    join public.tenants t on t.id = a.tenant_id
    left join public.tenant_customers tc on tc.id = a.tenant_customer_id
    left join public.end_customers ec on ec.id = a.end_customer_id
    left join public.tenant_services s on s.id = a.service_id
    left join public.tenant_staff_members sm on sm.id = a.staff_member_id
    left join public.tenant_bookable_resources resource
      on resource.id = a.bookable_resource_id
    left join public.tenant_message_templates confirmation_template
      on confirmation_template.tenant_id = a.tenant_id
      and confirmation_template.template_key = 'appointment_confirmation_reminder'
      and confirmation_template.channel = 'whatsapp'
      and confirmation_template.is_active = true
    left join public.tenant_message_templates one_hour_template
      on one_hour_template.tenant_id = a.tenant_id
      and one_hour_template.template_key = 'appointment_one_hour_reminder'
      and one_hour_template.channel = 'whatsapp'
      and one_hour_template.is_active = true
    where t.status = 'active'
      and t.plan in ('plan2', 'plan3')
      and a.deleted_at is null
      and a.status in ('scheduled', 'confirmed')
  ), notifications as (
    select d.*, 'confirmation'::text notification_type,
      'appointment_d1_' || to_char(d.local_start, 'YYYYMMDD') reminder_key,
      coalesce(
        d.confirmation_template,
        'Olá, {{customer_name}}! Seu agendamento em {{tenant_name}} está marcado para {{appointment_date}}, às {{appointment_time}}. Agendamento: {{service_name}}. Use os botões abaixo para confirmar, remarcar ou cancelar.'
      ) message_template
    from appointment_data d
    where d.status = 'scheduled'
      and d.starts_at > d.created_at + interval '24 hours'
      and d.local_start::date = d.local_now::date + 1
      and d.local_now::time >= time '09:00'
      and d.local_now::time < time '12:00'

    union all

    select d.*, 'one_hour_reminder'::text notification_type,
      'appointment_h1_' || to_char(d.local_start, 'YYYYMMDDHH24MI') reminder_key,
      coalesce(
        d.one_hour_template,
        'Olá, {{customer_name}}! Passando para lembrar que seu horário em {{tenant_name}} é hoje, às {{appointment_time}}. Agendamento: {{service_name}}. Até já! 😊'
      ) message_template
    from appointment_data d
    where d.starts_at > p_now
      and d.starts_at <= p_now + interval '1 hour'
  )
  select n.appointment_id, n.tenant_id, n.tenant_name, n.customer_name,
    n.customer_phone_e164, n.service_name, n.staff_member_name,
    n.starts_at, n.ends_at,
    to_char(n.local_start, 'DD/MM/YYYY'),
    to_char(n.local_start, 'HH24:MI'),
    n.notification_type, n.reminder_key, n.message_template
  from notifications n
  where n.customer_phone_e164 <> ''
    and not exists (
      select 1
      from public.appointment_reminder_events event
      where event.appointment_id = n.appointment_id
        and event.reminder_key = n.reminder_key
    )
  order by n.starts_at, n.notification_type;
$$;

create or replace function public.wa_appointment_mark_notification_sent(
  p_appointment_id uuid,
  p_reminder_key text,
  p_notification_type text,
  p_rendered_message text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_recipient text;
  v_service_id uuid;
  v_staff_member_id uuid;
  v_bookable_resource_id uuid;
  v_service_name text;
  v_staff_member_name text;
  v_bookable_resource_name text;
  v_duration_minutes integer;
  v_rows integer := 0;
begin
  if nullif(trim(coalesce(p_reminder_key, '')), '') is null
     or char_length(p_reminder_key) > 120 then
    raise exception 'invalid_reminder_key';
  end if;

  if p_notification_type not in ('confirmation', 'one_hour_reminder') then
    raise exception 'invalid_notification_type';
  end if;

  select
    a.tenant_id,
    regexp_replace(coalesce(tc.phone_e164, ec.whatsapp_e164, ''), '\D', '', 'g'),
    a.service_id,
    a.staff_member_id,
    a.bookable_resource_id,
    coalesce(a.service_name_snapshot, service.name),
    coalesce(a.staff_member_name_snapshot, staff.name),
    coalesce(a.bookable_resource_name_snapshot, resource.name),
    greatest(round(extract(epoch from (a.ends_at - a.starts_at)) / 60)::integer, 1)
  into
    v_tenant_id,
    v_recipient,
    v_service_id,
    v_staff_member_id,
    v_bookable_resource_id,
    v_service_name,
    v_staff_member_name,
    v_bookable_resource_name,
    v_duration_minutes
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services service on service.id = a.service_id
  left join public.tenant_staff_members staff on staff.id = a.staff_member_id
  left join public.tenant_bookable_resources resource
    on resource.id = a.bookable_resource_id
  where a.id = p_appointment_id;

  if v_tenant_id is null then
    raise exception 'appointment_not_found';
  end if;

  insert into public.appointment_reminder_events (
    appointment_id,
    tenant_id,
    reminder_key,
    channel,
    recipient_e164,
    rendered_message,
    payload
  ) values (
    p_appointment_id,
    v_tenant_id,
    p_reminder_key,
    'whatsapp',
    v_recipient,
    p_rendered_message,
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object('notification_type', p_notification_type)
  )
  on conflict (appointment_id, reminder_key) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 and p_notification_type = 'confirmation' then
    insert into public.wa_conversations (
      tenant_id,
      chat_id,
      step,
      payload_draft,
      is_closed,
      last_message_at
    ) values (
      v_tenant_id,
      v_recipient,
      'appointment_confirmation_action',
      jsonb_build_object(
        'version', 1,
        'module', 'appointments',
        'appointment', jsonb_build_object(
          'appointment_id', p_appointment_id,
          'customer_whatsapp', v_recipient,
          'booking_mode', case
            when v_bookable_resource_id is not null then 'resource'
            else 'service'
          end,
          'service_id', v_service_id,
          'service_name', v_service_name,
          'staff_member_id', v_staff_member_id,
          'staff_member_name', v_staff_member_name,
          'bookable_resource_id', v_bookable_resource_id,
          'bookable_resource_name', v_bookable_resource_name,
          'duration_minutes', v_duration_minutes
        ),
        'metadata', jsonb_build_object(
          'source', p_reminder_key,
          'reminder_sent_at', now()
        )
      ),
      false,
      now()
    )
    on conflict (tenant_id, chat_id)
      where coalesce(is_closed, false) = false
    do update set
      step = excluded.step,
      payload_draft = excluded.payload_draft,
      last_message_at = excluded.last_message_at;
  end if;
end;
$$;

revoke all on function public.wa_appointment_list_due_notifications(timestamptz, text)
from public, anon, authenticated;
grant execute on function public.wa_appointment_list_due_notifications(timestamptz, text)
to service_role;

revoke all on function public.wa_appointment_mark_notification_sent(
  uuid, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.wa_appointment_mark_notification_sent(
  uuid, text, text, text, jsonb
) to service_role;
