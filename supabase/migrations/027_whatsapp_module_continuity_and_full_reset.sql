-- Preserves active WhatsApp module conversations and centralizes a complete
-- customer routing reset without deleting inbox/message history.

create or replace function public.whatsapp_phone_variants(p_phone text)
returns text[]
language plpgsql
immutable
parallel safe
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_variants text[];
begin
  if v_phone = '' then
    return '{}'::text[];
  end if;

  v_variants := array[v_phone];

  -- Brazilian WhatsApp IDs may arrive with or without the mobile ninth digit.
  if left(v_phone, 2) = '55'
     and length(v_phone) = 13
     and substring(v_phone, 5, 1) = '9'
     and substring(v_phone, 6, 1) in ('6', '7', '8', '9') then
    v_variants := array_append(v_variants, overlay(v_phone placing '' from 5 for 1));
  elsif left(v_phone, 2) = '55'
        and length(v_phone) = 12
        and substring(v_phone, 5, 1) in ('6', '7', '8', '9') then
    v_variants := array_append(v_variants, overlay(v_phone placing '9' from 5 for 0));
  end if;

  return v_variants;
end;
$$;

revoke all on function public.whatsapp_phone_variants(text)
from public, anon, authenticated;
grant execute on function public.whatsapp_phone_variants(text) to service_role;

create or replace function public.admin_reset_whatsapp_customer_context(
  p_customer_phone_e164 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_router_sessions integer := 0;
  v_tenant_sessions integer := 0;
  v_module_conversations integer := 0;
  v_threads_closed integer := 0;
begin
  if v_phone = '' then
    raise exception 'customer_phone_required';
  end if;

  delete from public.platform_whatsapp_router_sessions
  where regexp_replace(customer_phone_e164, '\D', '', 'g') = any(v_phone_variants);
  get diagnostics v_router_sessions = row_count;

  delete from public.platform_whatsapp_tenant_sessions
  where regexp_replace(customer_phone_e164, '\D', '', 'g') = any(v_phone_variants);
  get diagnostics v_tenant_sessions = row_count;

  -- wa_conversations stores transient workflow state. The durable message
  -- history remains in tenant_whatsapp_messages/platform_whatsapp_messages.
  delete from public.wa_conversations
  where regexp_replace(chat_id, '\D', '', 'g') = any(v_phone_variants);
  get diagnostics v_module_conversations = row_count;

  update public.tenant_whatsapp_threads
  set status = 'closed', updated_at = now()
  where regexp_replace(customer_phone_e164, '\D', '', 'g') = any(v_phone_variants)
    and status = 'open';
  get diagnostics v_threads_closed = row_count;

  return jsonb_build_object(
    'ok', true,
    'customer_phone_e164', v_phone,
    'router_sessions_deleted', v_router_sessions,
    'tenant_sessions_deleted', v_tenant_sessions,
    'module_conversations_deleted', v_module_conversations,
    'tenant_threads_closed', v_threads_closed
  );
end;
$$;

revoke all on function public.admin_reset_whatsapp_customer_context(text)
from public, anon, authenticated;
grant execute on function public.admin_reset_whatsapp_customer_context(text) to service_role;

-- Keep the existing inbound recorder as the implementation and wrap it so an
-- explicit Menu do Jack command always performs the complete reset first.
do $$
begin
  if to_regprocedure(
    'public.admin_record_whatsapp_inbound_base(text,text,text,text,text,text,jsonb)'
  ) is null then
    alter function public.admin_record_whatsapp_inbound(
      text, text, text, text, text, text, jsonb
    ) rename to admin_record_whatsapp_inbound_base;
  end if;
end;
$$;

create or replace function public.admin_record_whatsapp_inbound(
  p_phone_number_id text,
  p_platform_phone_e164 text,
  p_customer_phone_e164 text,
  p_message_id text,
  p_body text,
  p_timestamp text default null,
  p_raw_event jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_normalized_body text := public.whatsapp_normalize_search_text(p_body);
begin
  if v_normalized_body in (
    'menu principal', 'menu do jack', 'trocar de negocio', 'outro negocio',
    'mudar de negocio', 'sair do negocio'
  ) then
    perform public.admin_reset_whatsapp_customer_context(p_customer_phone_e164);
    return null;
  end if;

  return public.admin_record_whatsapp_inbound_base(
    p_phone_number_id,
    p_platform_phone_e164,
    p_customer_phone_e164,
    p_message_id,
    p_body,
    p_timestamp,
    p_raw_event
  );
end;
$$;

revoke all on function public.admin_record_whatsapp_inbound(
  text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_record_whatsapp_inbound(
  text, text, text, text, text, text, jsonb
) to service_role;

-- Wrap the institutional/tenant router. An open module conversation has
-- priority over the tenant menu until the module closes itself.
do $$
begin
  if to_regprocedure(
    'public.admin_whatsapp_router_step_base(text,text,text,uuid)'
  ) is null then
    alter function public.admin_whatsapp_router_step(
      text, text, text, uuid
    ) rename to admin_whatsapp_router_step_base;
  end if;
end;
$$;

create or replace function public.admin_whatsapp_router_step(
  p_customer_phone_e164 text,
  p_message text,
  p_message_id text default null,
  p_inbox_thread_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_tenant_id uuid;
  v_tenant_name text;
  v_plan text;
  v_module text;
  v_target_workflow text;
  v_target_path text;
  v_route text;
begin
  if p_inbox_thread_id is not null then
    select th.tenant_id,
           coalesce(nullif(trim(t.public_name), ''), t.legal_name),
           t.plan
    into v_tenant_id, v_tenant_name, v_plan
    from public.tenant_whatsapp_threads th
    join public.tenants t on t.id = th.tenant_id
    where th.id = p_inbox_thread_id
      and t.status = 'active';
  end if;

  if v_tenant_id is not null then
    select nullif(trim(c.payload_draft ->> 'module'), '')
    into v_module
    from public.wa_conversations c
    where c.tenant_id = v_tenant_id
      and regexp_replace(c.chat_id, '\D', '', 'g') = any(v_phone_variants)
      and coalesce(c.is_closed, false) = false
      and coalesce(c.last_message_at, c.created_at) > now() - interval '2 hours'
    order by coalesce(c.last_message_at, c.created_at) desc
    limit 1;
  end if;

  if v_module = 'appointments' then
    v_route := 'appointments';
    v_target_workflow := 'WA_TENANT_APPOINTMENTS_INBOUND_v1';
    v_target_path := 'wa-tenant-appointments-inbound-v1';
  elsif v_module in ('billing', 'billing_signup') then
    v_route := 'billing_signup';
    v_target_workflow := 'WA_TENANT_BILLING_SIGNUP_INBOUND_v1';
    v_target_path := 'wa-tenant-billing-signup-inbound-v1';
  end if;

  if v_route is not null then
    return jsonb_build_object(
      'ok', true,
      'route', v_route,
      'reason', 'continue_active_module',
      'target_workflow', v_target_workflow,
      'target_webhook_path', v_target_path,
      'request_dispatch', true,
      'reply_text', null,
      'inbox_thread_id', p_inbox_thread_id,
      'inbox_routed', true,
      'tenant_id', v_tenant_id,
      'tenant_name', v_tenant_name,
      'tenant_plan', v_plan
    );
  end if;

  return public.admin_whatsapp_router_step_base(
    p_customer_phone_e164,
    p_message,
    p_message_id,
    p_inbox_thread_id
  );
end;
$$;

revoke all on function public.admin_whatsapp_router_step(text, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_whatsapp_router_step(text, text, text, uuid)
to service_role;
