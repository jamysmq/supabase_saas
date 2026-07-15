-- Restores the complete tenant billing signup RPC contract missing in production.
-- Requests remain pending and are approved through the teacher tenant panel.

create or replace function public.wa_billing_signup_load_or_create_context(
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
  v_tenant_id uuid;
  v_chat_id text;
  v_message_body text;
  v_link_code text;
  v_conversation_id uuid;
  v_step text;
  v_payload jsonb;
begin
  v_chat_id := regexp_replace(coalesce(p_chat_id, ''), '\D', '', 'g');
  v_message_body := nullif(trim(coalesce(p_message_body, '')), '');

  if v_chat_id = '' then
    raise exception 'chat_id_required';
  end if;

  if p_tenant_id is not null then
    select t.id
      into v_tenant_id
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3');
  end if;

  if v_tenant_id is null and v_message_body is not null then
    select lower(matches.captures[1])
      into v_link_code
    from regexp_matches(lower(v_message_body), '(jack-[a-z0-9]{8})') as matches(captures)
    limit 1;

    if v_link_code is not null then
      select l.tenant_id
        into v_tenant_id
      from public.tenant_whatsapp_entry_links l
      join public.tenants t on t.id = l.tenant_id
      where l.code = v_link_code
        and l.is_active = true
        and t.status = 'active'
        and t.plan in ('plan1', 'plan3')
      limit 1;
    end if;
  end if;

  if v_tenant_id is null then
    select c.tenant_id
      into v_tenant_id
    from public.wa_conversations c
    join public.tenants t on t.id = c.tenant_id
    where c.chat_id = v_chat_id
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
    order by coalesce(c.last_message_at, c.created_at) desc
    limit 1;
  end if;

  if v_tenant_id is null then
    select th.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_threads th
    join public.tenants t on t.id = th.tenant_id
    where th.customer_phone_e164 = v_chat_id
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
    order by coalesce(th.last_message_at, th.updated_at) desc
    limit 1;
  end if;

  if v_tenant_id is null and nullif(trim(coalesce(p_tenant_phone_e164, '')), '') is not null then
    select r.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_routing r
    join public.tenants t on t.id = r.tenant_id
    where regexp_replace(r.phone_e164, '\D', '', 'g') = regexp_replace(p_tenant_phone_e164, '\D', '', 'g')
      and r.is_active = true
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
    limit 1;
  end if;

  if v_tenant_id is null and nullif(trim(coalesce(p_tenant_phone_e164, '')), '') is not null then
    select n.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_numbers n
    join public.tenants t on t.id = n.tenant_id
    where regexp_replace(n.phone_e164, '\D', '', 'g') = regexp_replace(p_tenant_phone_e164, '\D', '', 'g')
      and n.is_active = true
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
    limit 1;
  end if;

  if v_tenant_id is null then
    raise exception 'tenant_not_found_or_plan_without_billing';
  end if;

  select c.id, c.step, c.payload_draft
    into v_conversation_id, v_step, v_payload
  from public.wa_conversations c
  where c.tenant_id = v_tenant_id
    and c.chat_id = v_chat_id
    and coalesce(c.is_closed, false) = false
  order by c.last_message_at desc nulls last, c.created_at desc
  limit 1;

  if v_conversation_id is null then
    insert into public.wa_conversations (
      tenant_id,
      chat_id,
      step,
      payload_draft,
      is_closed,
      last_message_at
    )
    values (
      v_tenant_id,
      v_chat_id,
      'billing_signup_welcome',
      public.jsonb_deep_merge(
        jsonb_build_object(
          'version', 1,
          'module', 'billing_signup',
          'signup', jsonb_build_object(
            'customer_whatsapp', v_chat_id,
            'entry_link_code', v_link_code
          ),
          'metadata', jsonb_build_object(
            'source', 'whatsapp',
            'started_at', now()
          )
        ),
        coalesce(p_init_payload, '{}'::jsonb)
      ),
      false,
      now()
    )
    returning wa_conversations.id, wa_conversations.step, wa_conversations.payload_draft
      into v_conversation_id, v_step, v_payload;
  else
    update public.wa_conversations
       set last_message_at = now()
     where id = v_conversation_id;
  end if;

  return query
  select
    v_conversation_id,
    t.id,
    t.legal_name,
    t.plan,
    t.business_type,
    v_step,
    coalesce(v_payload, '{}'::jsonb),
    coalesce(
      mt.content,
      'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Vou fazer seu cadastro. Para comecar, envie seu nome completo.'
    ),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', g.id,
          'name', g.name
        )
        order by g.name
      )
      from public.tenant_customer_groups g
      where g.tenant_id = t.id
    ), '[]'::jsonb)
  from public.tenants t
  left join public.tenant_message_templates mt
    on mt.tenant_id = t.id
   and mt.template_key = 'billing_signup_welcome'
   and mt.channel = 'whatsapp'
   and mt.is_active = true
  where t.id = v_tenant_id;
end;
$$;

create or replace function public.wa_billing_signup_create_customer(
  p_tenant_id uuid,
  p_full_name text,
  p_whatsapp_e164 text,
  p_amount_cents integer,
  p_due_day integer,
  p_group_id uuid default null,
  p_notes text default null
)
returns table (
  customer_id uuid,
  billing_cycle_id uuid,
  created_customer boolean,
  created_billing_profile boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_billing_cycle_id uuid;
  v_phone text;
  v_created_customer boolean := false;
  v_existing_profile_id uuid;
begin
  v_phone := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');

  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
  ) then
    raise exception 'tenant_not_found_or_plan_without_billing';
  end if;

  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'full_name_required';
  end if;

  if v_phone = '' then
    raise exception 'whatsapp_required';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_due_day is null or p_due_day < 1 or p_due_day > 31 then
    raise exception 'invalid_due_day';
  end if;

  if p_group_id is not null and not exists (
    select 1
    from public.tenant_customer_groups g
    where g.id = p_group_id
      and g.tenant_id = p_tenant_id
  ) then
    raise exception 'group_not_found';
  end if;

  select tc.id
    into v_customer_id
  from public.tenant_customers tc
  where tc.tenant_id = p_tenant_id
    and regexp_replace(coalesce(tc.phone_e164, ''), '\D', '', 'g') = v_phone
  order by tc.created_at desc
  limit 1;

  if v_customer_id is null then
    insert into public.tenant_customers (
      tenant_id,
      full_name,
      phone_e164,
      email,
      cpf,
      notes,
      is_active,
      group_id
    )
    values (
      p_tenant_id,
      trim(p_full_name),
      v_phone,
      null,
      null,
      p_notes,
      true,
      p_group_id
    )
    returning id into v_customer_id;

    v_created_customer := true;
  else
    update public.tenant_customers
       set full_name = trim(p_full_name),
           phone_e164 = v_phone,
           notes = coalesce(p_notes, notes),
           is_active = true,
           group_id = coalesce(p_group_id, group_id),
           updated_at = now()
     where id = v_customer_id;
  end if;

  select cbp.id
    into v_existing_profile_id
  from public.customer_billing_profiles cbp
  where cbp.tenant_id = p_tenant_id
    and cbp.customer_id = v_customer_id
    and cbp.status = 'active'
  order by cbp.created_at desc
  limit 1;

  if v_existing_profile_id is null then
    perform public.admin_create_billing_profile(
      p_tenant_id,
      v_customer_id,
      p_amount_cents,
      p_due_day,
      null,
      null
    );

    created_billing_profile := true;
  else
    update public.customer_billing_profiles
       set amount_cents = p_amount_cents,
           due_day = p_due_day,
           updated_at = now()
     where id = v_existing_profile_id;

    created_billing_profile := false;
  end if;

  v_billing_cycle_id := public.admin_create_initial_customer_billing_cycle(p_tenant_id, v_customer_id);

  customer_id := v_customer_id;
  billing_cycle_id := v_billing_cycle_id;
  created_customer := v_created_customer;

  return next;
end;
$$;

create or replace function public.wa_billing_signup_conversation_patch(
  p_conversation_id uuid,
  p_step text,
  p_patch jsonb default '{}'::jsonb,
  p_close boolean default false
)
returns table (
  conversation_id uuid,
  step text,
  payload_draft jsonb,
  is_closed boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  conversation_id := null;
  step := null;
  payload_draft := null;
  is_closed := null;

  if p_conversation_id is null then
    raise exception 'conversation_id_required';
  end if;

  update public.wa_conversations c
     set step = coalesce(nullif(trim(p_step), ''), c.step),
         payload_draft = public.jsonb_deep_merge(coalesce(c.payload_draft, '{}'::jsonb), coalesce(p_patch, '{}'::jsonb)),
         is_closed = coalesce(p_close, false),
         last_message_at = now()
   where c.id = p_conversation_id
  returning c.id, c.step, c.payload_draft, c.is_closed
    into conversation_id, step, payload_draft, is_closed;

  if conversation_id is null then
    raise exception 'conversation_not_found';
  end if;

  return next;
end;
$$;

revoke all on function public.wa_billing_signup_load_or_create_context(uuid, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_load_or_create_context(uuid, text, text, text, jsonb)
to service_role;

revoke all on function public.wa_billing_signup_create_customer(uuid, text, text, integer, integer, uuid, text)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_create_customer(uuid, text, text, integer, integer, uuid, text)
to service_role;

revoke all on function public.wa_billing_signup_conversation_patch(uuid, text, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_conversation_patch(uuid, text, jsonb, boolean)
to service_role;
