-- Teacher controls for WhatsApp signups and capacity-aware customer groups.

alter table public.tenants
add column if not exists whatsapp_customer_signup_enabled boolean not null default true;

alter table public.tenant_customer_groups
add column if not exists max_members integer;

alter table public.tenant_customer_groups
drop constraint if exists tenant_customer_groups_max_members_check;

alter table public.tenant_customer_groups
add constraint tenant_customer_groups_max_members_check
check (max_members is null or max_members > 0);

comment on column public.tenants.whatsapp_customer_signup_enabled is
  'Allows the tenant to accept new customer signup requests through Jack on WhatsApp.';

comment on column public.tenant_customer_groups.max_members is
  'Optional maximum number of active customers assigned to this group.';

update public.tenant_message_templates
set content = 'Olá! Eu sou o Jack, assistente virtual de {{tenant_name}}. Vou receber seus dados para o professor analisar seu cadastro. Para começar, qual é o seu nome completo?',
    updated_at = now()
where template_key = 'billing_signup_welcome'
  and channel = 'whatsapp';

create or replace function public.wa_billing_signup_load_or_create_context_v2(
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
  groups jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_context record;
  v_enabled boolean := true;
  v_step text;
  v_groups jsonb := '[]'::jsonb;
begin
  select * into v_context
  from public.wa_billing_signup_load_or_create_context(
    p_tenant_id,
    p_tenant_phone_e164,
    p_chat_id,
    p_message_body,
    p_init_payload
  );

  select coalesce(t.whatsapp_customer_signup_enabled, true)
  into v_enabled
  from public.tenants t
  where t.id = v_context.tenant_id;

  v_step := v_context.step;

  if not v_enabled then
    v_step := 'billing_signup_disabled';
  elsif v_step = 'billing_signup_disabled' then
    v_step := 'billing_signup_welcome';
  end if;

  if v_step is distinct from v_context.step then
    update public.wa_conversations c
    set step = v_step,
        last_message_at = now()
    where c.id = v_context.conversation_id;
  end if;

  if v_enabled then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', available.id,
        'name', available.name,
        'max_members', available.max_members,
        'current_members', available.current_members,
        'available_spots', case
          when available.max_members is null then null
          else available.max_members - available.current_members
        end
      ) order by available.name
    ), '[]'::jsonb)
    into v_groups
    from (
      select g.id, g.name, g.max_members,
        count(tc.id)::integer as current_members
      from public.tenant_customer_groups g
      left join public.tenant_customers tc
        on tc.tenant_id = g.tenant_id
       and tc.group_id = g.id
       and tc.is_active = true
      where g.tenant_id = v_context.tenant_id
        and g.is_active = true
      group by g.id, g.name, g.max_members
      having g.max_members is null or count(tc.id) < g.max_members
    ) available;
  end if;

  return query
  select
    v_context.conversation_id::uuid,
    v_context.tenant_id::uuid,
    v_context.tenant_name::text,
    v_context.tenant_plan::text,
    v_context.tenant_business_type::text,
    v_step,
    coalesce(v_context.payload_draft, '{}'::jsonb),
    case
      when v_enabled then coalesce(
        nullif(trim(v_context.welcome_message), ''),
        'Olá! Eu sou o Jack, assistente virtual de {{tenant_name}}. Vou receber seus dados para o professor analisar seu cadastro. Para começar, qual é o seu nome completo?'
      )
      else 'No momento, {{tenant_name}} não está recebendo novos cadastros pelo WhatsApp. Para mais informações, escolha a opção de atendimento humano.'
    end,
    v_groups;
end;
$$;

create or replace function public.wa_billing_signup_submit_request_v2(
  p_tenant_id uuid,
  p_full_name text,
  p_whatsapp_e164 text,
  p_amount_cents integer,
  p_due_day integer,
  p_group_id uuid default null,
  p_group_name text default null,
  p_notes text default null
)
returns table (request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_members integer;
  v_current_members integer;
begin
  if not exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.business_type = 'teacher'
      and t.plan in ('plan1', 'plan3')
      and coalesce(t.whatsapp_customer_signup_enabled, true) = true
  ) then
    raise exception 'whatsapp_customer_signup_disabled';
  end if;

  if p_group_id is not null then
    select g.max_members,
      (select count(*)::integer from public.tenant_customers tc
       where tc.tenant_id = p_tenant_id and tc.group_id = g.id and tc.is_active = true)
    into v_max_members, v_current_members
    from public.tenant_customer_groups g
    where g.id = p_group_id and g.tenant_id = p_tenant_id and g.is_active = true;

    if not found then raise exception 'group_not_found'; end if;
    if v_max_members is not null and v_current_members >= v_max_members then
      raise exception 'group_is_full';
    end if;
  end if;

  return query
  select submitted.request_id, submitted.request_status
  from public.wa_billing_signup_submit_request(
    p_tenant_id,
    p_full_name,
    p_whatsapp_e164,
    p_amount_cents,
    p_due_day,
    p_group_id,
    p_group_name,
    p_notes
  ) submitted;
end;
$$;

create or replace function public.admin_approve_teacher_customer_signup_with_group(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reviewed_by_tenant_user_id uuid,
  p_group_id uuid default null
)
returns table (request_id uuid, customer_id uuid, billing_cycle_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text;
  v_max_members integer;
  v_current_members integer;
  v_updated_request uuid;
begin
  if not exists (
    select 1 from public.tenant_users tu
    join public.tenants t on t.id = tu.tenant_id
    where tu.id = p_reviewed_by_tenant_user_id
      and tu.tenant_id = p_tenant_id
      and t.business_type = 'teacher'
      and t.plan in ('plan1', 'plan3')
  ) then
    raise exception 'tenant_reviewer_not_allowed';
  end if;

  if p_group_id is not null then
    select g.name, g.max_members
    into v_group_name, v_max_members
    from public.tenant_customer_groups g
    where g.id = p_group_id
      and g.tenant_id = p_tenant_id
      and g.is_active = true
    for update;

    if not found then raise exception 'group_not_found'; end if;

    select count(*)::integer into v_current_members
    from public.tenant_customers tc
    where tc.tenant_id = p_tenant_id
      and tc.group_id = p_group_id
      and tc.is_active = true;

    if v_max_members is not null and v_current_members >= v_max_members then
      raise exception 'group_is_full';
    end if;
  end if;

  update public.tenant_customer_signup_requests r
  set group_id = p_group_id,
      group_name_snapshot = v_group_name,
      updated_at = now()
  where r.id = p_request_id
    and r.tenant_id = p_tenant_id
    and r.status = 'pending'
  returning r.id into v_updated_request;

  if v_updated_request is null then
    raise exception 'signup_request_not_found_or_already_reviewed';
  end if;

  return query
  select approved.request_id, approved.customer_id, approved.billing_cycle_id
  from public.admin_approve_teacher_customer_signup(
    p_tenant_id,
    p_request_id,
    p_reviewed_by_tenant_user_id
  ) approved;
end;
$$;

revoke all on function public.wa_billing_signup_load_or_create_context_v2(uuid, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_load_or_create_context_v2(uuid, text, text, text, jsonb)
to service_role;

revoke all on function public.wa_billing_signup_submit_request_v2(uuid, text, text, integer, integer, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_submit_request_v2(uuid, text, text, integer, integer, uuid, text, text)
to service_role;

revoke all on function public.admin_approve_teacher_customer_signup_with_group(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_approve_teacher_customer_signup_with_group(uuid, uuid, uuid, uuid)
to service_role;
