-- Lets an explicit human-support request leave an active WhatsApp module.
-- The tenant router handles the handoff and the transient module state closes
-- so later messages cannot accidentally continue a signup or appointment form.

do $migration$
begin
  if to_regprocedure(
    'public.admin_whatsapp_router_step_module_continuity_base(text,text,text,uuid)'
  ) is null then
    alter function public.admin_whatsapp_router_step_module_continuity(
      text, text, text, uuid
    ) rename to admin_whatsapp_router_step_module_continuity_base;
  end if;
end
$migration$;

create or replace function public.admin_whatsapp_router_step_module_continuity(
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
  v_text text := public.whatsapp_normalize_search_text(p_message);
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_result jsonb;
  v_tenant_id uuid;
begin
  if v_text like '%atend%'
     or v_text like '%human%'
     or v_text like '%pessoa%' then
    v_result := public.admin_whatsapp_router_step_base(
      p_customer_phone_e164,
      p_message,
      p_message_id,
      p_inbox_thread_id
    );

    if v_result ->> 'route' = 'tenant_human_handoff' then
      v_tenant_id := nullif(v_result ->> 'tenant_id', '')::uuid;

      update public.wa_conversations conversation
      set is_closed = true,
          last_message_at = now(),
          payload_draft = public.jsonb_deep_merge(
            coalesce(conversation.payload_draft, '{}'::jsonb),
            jsonb_build_object(
              'metadata', jsonb_build_object(
                'closed_reason', 'tenant_human_handoff',
                'closed_at', now()
              )
            )
          )
      where conversation.tenant_id = v_tenant_id
        and regexp_replace(conversation.chat_id, '\D', '', 'g') = any(v_phone_variants)
        and coalesce(conversation.is_closed, false) = false;
    end if;

    return v_result;
  end if;

  return public.admin_whatsapp_router_step_module_continuity_base(
    p_customer_phone_e164,
    p_message,
    p_message_id,
    p_inbox_thread_id
  );
end;
$$;

revoke all on function public.admin_whatsapp_router_step_module_continuity(
  text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.admin_whatsapp_router_step_module_continuity(
  text, text, text, uuid
) to service_role;
