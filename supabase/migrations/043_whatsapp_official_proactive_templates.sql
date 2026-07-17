-- Uses free-form appointment reminders only while the customer's conversation
-- with the same business is inside Meta's 24-hour service window.

update public.tenant_message_templates
set content = 'Olá, {{customer_name}}! Este é um lembrete automático de cobrança enviado pelo Assistente Jack em nome de {{tenant_name}}. Sua mensalidade no valor de {{amount}} vence em {{due_date}}. A chave Pix para pagamento é {{pix_key}}. Se você já realizou o pagamento, desconsidere esta mensagem. Em caso de dúvida, fale com a equipe responsável.',
    updated_at = now()
where template_key = 'billing_reminder_due_today'
  and channel = 'whatsapp';

create or replace function public.wa_appointment_list_due_notifications_v2(
  p_now timestamptz default now(),
  p_timezone text default 'America/Fortaleza'
)
returns table (
  appointment_id uuid, tenant_id uuid, tenant_name text, customer_name text,
  customer_phone_e164 text, service_name text, staff_member_name text,
  starts_at timestamptz, ends_at timestamptz, appointment_date text,
  appointment_time text, notification_type text, reminder_key text,
  message_template text, freeform_window_open boolean
)
language sql
security definer
set search_path = public
as $$
  select
    due.appointment_id,
    due.tenant_id,
    due.tenant_name,
    due.customer_name,
    due.customer_phone_e164,
    due.service_name,
    due.staff_member_name,
    due.starts_at,
    due.ends_at,
    due.appointment_date,
    due.appointment_time,
    due.notification_type,
    due.reminder_key,
    due.message_template,
    exists (
      select 1
      from public.tenant_whatsapp_threads thread
      where thread.tenant_id = due.tenant_id
        and regexp_replace(coalesce(thread.customer_phone_e164, ''), '\D', '', 'g') = any (
          public.whatsapp_phone_variants(due.customer_phone_e164)
        )
        and thread.last_inbound_at >= p_now - interval '24 hours'
    ) as freeform_window_open
  from public.wa_appointment_list_due_notifications(p_now, p_timezone) due;
$$;

revoke all on function public.wa_appointment_list_due_notifications_v2(timestamptz, text)
from public, anon, authenticated;
grant execute on function public.wa_appointment_list_due_notifications_v2(timestamptz, text)
to service_role;
