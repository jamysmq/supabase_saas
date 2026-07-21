-- A tenant entry-link message contains the word "atendimento". Without an
-- explicit priority rule, the tenant router can mistake that first contact for
-- a human-handoff request and never present the tenant menu.

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
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_tenant_id uuid;
  v_tenant_name text;
  v_plan text;
  v_module text;
  v_entry_link_code text;
  v_target_workflow text;
  v_target_path text;
  v_route text;
begin
  if p_inbox_thread_id is not null then
    select
      thread.tenant_id,
      coalesce(nullif(trim(tenant.public_name), ''), tenant.legal_name),
      tenant.plan
    into v_tenant_id, v_tenant_name, v_plan
    from public.tenant_whatsapp_threads thread
    join public.tenants tenant on tenant.id = thread.tenant_id
    where thread.id = p_inbox_thread_id
      and tenant.status = 'active';
  end if;

  select lower(matches.captures[1])
  into v_entry_link_code
  from regexp_matches(
    lower(coalesce(p_message, '')),
    '(jack-[a-z0-9]{8})'
  ) as matches(captures)
  limit 1;

  if v_tenant_id is not null
     and v_entry_link_code is not null
     and exists (
       select 1
       from public.tenant_whatsapp_entry_links link
       where link.tenant_id = v_tenant_id
         and link.code = v_entry_link_code
         and link.is_active = true
     ) then
    -- Clicking a tenant link is an explicit request to start from that
    -- tenant's menu. Remove only transient module state; inbox history and the
    -- tenant binding created from the link remain intact.
    delete from public.wa_conversations conversation
    where conversation.tenant_id = v_tenant_id
      and regexp_replace(conversation.chat_id, '\D', '', 'g') = any(v_phone_variants)
      and coalesce(conversation.is_closed, false) = false;

    return public.admin_whatsapp_router_step_base(
      p_customer_phone_e164,
      'menu',
      p_message_id,
      p_inbox_thread_id
    ) || jsonb_build_object(
      'reason', 'tenant_entry_link',
      'entry_link_code', v_entry_link_code
    );
  end if;

  if v_tenant_id is not null then
    select nullif(trim(conversation.payload_draft ->> 'module'), '')
    into v_module
    from public.wa_conversations conversation
    where conversation.tenant_id = v_tenant_id
      and regexp_replace(conversation.chat_id, '\D', '', 'g') = any(v_phone_variants)
      and coalesce(conversation.is_closed, false) = false
      and coalesce(conversation.last_message_at, conversation.created_at) > now() - interval '2 hours'
    order by coalesce(conversation.last_message_at, conversation.created_at) desc
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

comment on function public.admin_whatsapp_router_step(text, text, text, uuid) is
  'Routes valid tenant entry links to the tenant menu before keyword-based human handoff.';
