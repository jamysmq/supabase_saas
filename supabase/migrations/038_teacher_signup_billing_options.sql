-- Prescribed billing options for teacher customer signups.

alter table public.tenants
add column if not exists whatsapp_signup_billing_mode text not null default 'fixed';

alter table public.tenants
drop constraint if exists tenants_whatsapp_signup_billing_mode_check;

alter table public.tenants
add constraint tenants_whatsapp_signup_billing_mode_check
check (whatsapp_signup_billing_mode in ('fixed', 'plans'));

alter table public.tenants
add column if not exists whatsapp_signup_fixed_amount_cents integer;

alter table public.tenants
add column if not exists whatsapp_signup_fixed_due_day integer;

alter table public.tenants
drop constraint if exists tenants_whatsapp_signup_fixed_amount_check;

alter table public.tenants
add constraint tenants_whatsapp_signup_fixed_amount_check
check (whatsapp_signup_fixed_amount_cents is null or whatsapp_signup_fixed_amount_cents > 0);

alter table public.tenants
drop constraint if exists tenants_whatsapp_signup_fixed_due_day_check;

alter table public.tenants
add constraint tenants_whatsapp_signup_fixed_due_day_check
check (whatsapp_signup_fixed_due_day is null or whatsapp_signup_fixed_due_day between 1 and 31);

create table if not exists public.tenant_customer_signup_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  amount_cents integer not null check (amount_cents > 0),
  due_day integer not null check (due_day between 1 and 31),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_customer_signup_plans_name_check check (char_length(trim(name)) between 1 and 80),
  constraint tenant_customer_signup_plans_description_check check (description is null or char_length(description) <= 240)
);

create unique index if not exists tenant_customer_signup_plans_active_name_uq
on public.tenant_customer_signup_plans(tenant_id, lower(name))
where is_active = true;

create index if not exists tenant_customer_signup_plans_tenant_active_idx
on public.tenant_customer_signup_plans(tenant_id, is_active, sort_order, name);

alter table public.tenant_customer_signup_plans enable row level security;

drop policy if exists tenant_customer_signup_plans_manage_own_tenant
on public.tenant_customer_signup_plans;
create policy tenant_customer_signup_plans_manage_own_tenant
on public.tenant_customer_signup_plans for all to authenticated
using (exists (
  select 1 from public.tenant_users tu
  where tu.tenant_id = tenant_customer_signup_plans.tenant_id
    and tu.auth_user_id = auth.uid()
))
with check (exists (
  select 1 from public.tenant_users tu
  where tu.tenant_id = tenant_customer_signup_plans.tenant_id
    and tu.auth_user_id = auth.uid()
));

grant select, insert, update, delete on public.tenant_customer_signup_plans
to authenticated, service_role;

alter table public.tenant_customer_signup_requests
add column if not exists signup_plan_id uuid references public.tenant_customer_signup_plans(id) on delete set null;

alter table public.tenant_customer_signup_requests
add column if not exists signup_plan_name_snapshot text;

update public.tenant_message_templates
set content = 'Olá! Eu sou o Jack, assistente virtual de {{tenant_name}}. Vou receber seus dados e encaminhá-los para análise de {{tenant_name}}. Para começar, qual é o seu nome completo?',
    updated_at = now()
where template_key = 'billing_signup_welcome'
  and channel = 'whatsapp';

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

  -- Old drafts asked the customer to type an amount and due date. Restart
  -- them once so every active signup uses the tenant-prescribed values.
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
    case when v_step = 'billing_signup_configuration_missing'
      then 'O cadastro pelo WhatsApp está temporariamente indisponível porque {{tenant_name}} ainda está configurando as mensalidades. Para receber ajuda, escolha o atendimento humano.'
      else v_context.welcome_message::text end,
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

create or replace function public.wa_billing_signup_submit_request_v3(
  p_tenant_id uuid,
  p_full_name text,
  p_whatsapp_e164 text,
  p_group_id uuid default null,
  p_group_name text default null,
  p_signup_plan_id uuid default null,
  p_notes text default null
)
returns table (request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_amount_cents integer;
  v_due_day integer;
  v_plan_name text;
  v_result record;
begin
  select t.whatsapp_signup_billing_mode,
         t.whatsapp_signup_fixed_amount_cents,
         t.whatsapp_signup_fixed_due_day
  into v_mode, v_amount_cents, v_due_day
  from public.tenants t
  where t.id = p_tenant_id
    and t.status = 'active'
    and t.business_type = 'teacher'
    and t.plan in ('plan1', 'plan3')
    and t.whatsapp_customer_signup_enabled = true;

  if not found then raise exception 'whatsapp_customer_signup_disabled'; end if;

  if v_mode = 'plans' then
    select p.amount_cents, p.due_day, p.name
    into v_amount_cents, v_due_day, v_plan_name
    from public.tenant_customer_signup_plans p
    where p.id = p_signup_plan_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true;
    if not found then raise exception 'signup_plan_not_found'; end if;
  elsif v_mode = 'fixed' then
    if v_amount_cents is null or v_due_day is null then
      raise exception 'fixed_signup_billing_not_configured';
    end if;
    v_plan_name := 'Mensalidade fixa';
  else
    raise exception 'invalid_signup_billing_mode';
  end if;

  select * into v_result
  from public.wa_billing_signup_submit_request_v2(
    p_tenant_id, p_full_name, p_whatsapp_e164, v_amount_cents, v_due_day,
    p_group_id, p_group_name, p_notes
  );

  update public.tenant_customer_signup_requests r
  set signup_plan_id = case when v_mode = 'plans' then p_signup_plan_id else null end,
      signup_plan_name_snapshot = v_plan_name,
      updated_at = now()
  where r.id = v_result.request_id;

  request_id := v_result.request_id;
  request_status := v_result.request_status;
  return next;
end;
$$;

revoke all on function public.wa_billing_signup_load_or_create_context_v3(uuid, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_load_or_create_context_v3(uuid, text, text, text, jsonb)
to service_role;

revoke all on function public.wa_billing_signup_submit_request_v3(uuid, text, text, uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_submit_request_v3(uuid, text, text, uuid, text, uuid, text)
to service_role;
