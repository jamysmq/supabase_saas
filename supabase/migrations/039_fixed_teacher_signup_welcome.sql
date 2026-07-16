-- Keeps the teacher signup opening message under platform control.
-- Only billing reminders remain customizable by each business.

update public.tenant_message_templates
set is_active = false,
    updated_at = now()
where template_key = 'billing_signup_welcome';

create or replace function public.wa_billing_signup_load_or_create_context_v3(
  p_tenant_id uuid default null,
  p_tenant_phone_e164 text default null,
  p_chat_id text default null,
  p_message_body text default null,
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
  groups jsonb,
  signup_config jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_mode text;
  v_fixed_amount integer;
  v_fixed_due_day integer;
  v_plans jsonb := '[]'::jsonb;
  v_ready boolean := false;
  v_step text;
  v_tenant_name text;
begin
  select * into v_context
  from public.wa_billing_signup_load_or_create_context_v2(
    p_tenant_id, p_tenant_phone_e164, p_chat_id, p_message_body, p_init_payload
  );

  select t.whatsapp_signup_billing_mode,
         t.whatsapp_signup_fixed_amount_cents,
         t.whatsapp_signup_fixed_due_day,
         coalesce(nullif(trim(t.public_name), ''), t.legal_name)
  into v_mode, v_fixed_amount, v_fixed_due_day, v_tenant_name
  from public.tenants t
  where t.id = v_context.tenant_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'description', p.description,
    'amount_cents', p.amount_cents,
    'due_day', p.due_day
  ) order by p.sort_order, p.name), '[]'::jsonb)
  into v_plans
  from public.tenant_customer_signup_plans p
  where p.tenant_id = v_context.tenant_id and p.is_active = true;

  v_ready := case
    when v_mode = 'fixed' then v_fixed_amount is not null and v_fixed_due_day is not null
    when v_mode = 'plans' then jsonb_array_length(v_plans) > 0
    else false
  end;

  v_step := v_context.step;
  if v_step <> 'billing_signup_disabled' and not v_ready then
    v_step := 'billing_signup_configuration_missing';
  elsif v_ready and v_step = 'billing_signup_configuration_missing' then
    v_step := 'billing_signup_welcome';
  end if;

  if v_ready
     and v_step <> 'billing_signup_disabled'
     and coalesce(v_context.payload_draft ->> 'flow_version', '') <> '3' then
    v_step := 'billing_signup_welcome';
  end if;

  if v_step is distinct from v_context.step then
    update public.wa_conversations c
    set step = v_step, payload_draft = '{}'::jsonb, last_message_at = now()
    where c.id = v_context.conversation_id;
  end if;

  return query select
    v_context.conversation_id::uuid,
    v_context.tenant_id::uuid,
    v_tenant_name,
    v_context.tenant_plan::text,
    v_context.tenant_business_type::text,
    v_step,
    case when v_step = 'billing_signup_configuration_missing' then '{}'::jsonb
         else coalesce(v_context.payload_draft, '{}'::jsonb) end,
    case
      when v_step = 'billing_signup_configuration_missing' then
        'O cadastro pelo WhatsApp está temporariamente indisponível porque {{tenant_name}} ainda está configurando as mensalidades. Para receber ajuda, escolha o atendimento humano.'
      when v_step = 'billing_signup_disabled' then
        'No momento, {{tenant_name}} não está recebendo novos cadastros pelo WhatsApp. Para mais informações, escolha o atendimento humano.'
      else
        'Olá! Eu sou o Jack, assistente virtual de {{tenant_name}}. Vou receber seus dados e encaminhá-los para análise de {{tenant_name}}. Para começar, qual é o seu nome completo?'
    end,
    v_context.groups::jsonb,
    jsonb_build_object(
      'mode', v_mode,
      'fixed_amount_cents', v_fixed_amount,
      'fixed_due_day', v_fixed_due_day,
      'plans', v_plans,
      'ready', v_ready
    );
end;
$$;

revoke all on function public.wa_billing_signup_load_or_create_context_v3(uuid, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_load_or_create_context_v3(uuid, text, text, text, jsonb)
to service_role;
