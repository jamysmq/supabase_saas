create or replace function public.wa_appointment_load_or_create_context_v3(
  p_tenant_id uuid default null,
  p_tenant_phone_e164 text default null,
  p_chat_id text default null,
  p_init_payload jsonb default '{}'::jsonb
)
returns table (
  conversation_id uuid,
  tenant_id uuid,
  tenant_name text,
  tenant_plan text,
  tenant_business_type text,
  step text,
  payload_draft jsonb,
  welcome_message text,
  services jsonb,
  staff_members jsonb,
  upcoming_appointments jsonb,
  bookable_resources jsonb,
  pix_key text,
  pix_beneficiary_name text
)
language sql
security definer
set search_path = public
as $$
  select
    base.conversation_id,
    base.tenant_id,
    base.tenant_name,
    base.tenant_plan,
    base.tenant_business_type,
    base.step,
    base.payload_draft,
    base.welcome_message,
    base.services,
    base.staff_members,
    base.upcoming_appointments,
    base.bookable_resources,
    settings.pix_key,
    settings.pix_beneficiary_name
  from public.wa_appointment_load_or_create_context_v2(
    p_tenant_id, p_tenant_phone_e164, p_chat_id, p_init_payload
  ) base
  left join public.tenant_billing_settings settings on settings.tenant_id = base.tenant_id;
$$;

revoke all on function public.wa_appointment_load_or_create_context_v3(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.wa_appointment_load_or_create_context_v3(
  uuid, text, text, jsonb
) to service_role;
