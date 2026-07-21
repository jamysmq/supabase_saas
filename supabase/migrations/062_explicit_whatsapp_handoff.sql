-- Require an explicit request before handing a WhatsApp conversation to a
-- human. A generic occurrence of "atendimento" must not be enough.

create or replace function public.whatsapp_is_explicit_human_handoff(
  p_message text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select
    public.whatsapp_normalize_search_text(p_message) in (
      'atendimento humano',
      'falar com atendimento humano',
      'quero atendimento humano',
      'preciso de atendimento humano',
      'falar com atendente',
      'quero falar com atendente',
      'falar com uma pessoa',
      'falar com pessoa',
      'quero falar com uma pessoa',
      'preciso falar com uma pessoa',
      'quero falar com alguem',
      'preciso falar com alguem',
      'atendente humano'
    )
    or public.whatsapp_normalize_search_text(p_message) ~
      '(^| )(falar|conversar|chamar|transferir|encaminhar).*(humano|atendente|pessoa|alguem)( |$)'
    or public.whatsapp_normalize_search_text(p_message) ~
      '(^| )(humano|atendente|pessoa|alguem).*(falar|conversar|chamar|transferir|encaminhar)( |$)';
$$;

revoke all on function public.whatsapp_is_explicit_human_handoff(text)
from public, anon, authenticated;
grant execute on function public.whatsapp_is_explicit_human_handoff(text)
to service_role;

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
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_result jsonb;
  v_tenant_id uuid;
begin
  if public.whatsapp_is_explicit_human_handoff(p_message) then
    v_result := public.admin_whatsapp_router_step_module_continuity_base(
      p_customer_phone_e164,
      'atendimento humano',
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

  v_result := public.admin_whatsapp_router_step_module_continuity_base(
    p_customer_phone_e164,
    p_message,
    p_message_id,
    p_inbox_thread_id
  );

  if v_result ->> 'route' in ('tenant_human_handoff', 'platform_human_handoff') then
    return public.admin_whatsapp_router_step_module_continuity_base(
      p_customer_phone_e164,
      '__invalid_non_handoff_choice__',
      p_message_id,
      p_inbox_thread_id
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_whatsapp_router_step_module_continuity(
  text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.admin_whatsapp_router_step_module_continuity(
  text, text, text, uuid
) to service_role;

-- Restore the contextual router layer and add entry-link priority ahead of
-- module continuity and keyword classification.
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
  v_text text := public.whatsapp_normalize_search_text(p_message);
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_tenant_id uuid;
  v_tenant_name text;
  v_plan text;
  v_entry_link_code text;
  v_recent_completed_appointment boolean := false;
  v_result jsonb;
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
    delete from public.wa_conversations conversation
    where conversation.tenant_id = v_tenant_id
      and regexp_replace(conversation.chat_id, '\D', '', 'g') = any(v_phone_variants)
      and coalesce(conversation.is_closed, false) = false;

    v_result := public.admin_whatsapp_router_step_module_continuity(
      p_customer_phone_e164,
      'menu',
      p_message_id,
      p_inbox_thread_id
    );

    return v_result || jsonb_build_object(
      'reason', 'tenant_entry_link',
      'entry_link_code', v_entry_link_code
    );
  end if;

  if p_inbox_thread_id is not null
     and v_text in ('obrigado', 'obrigada', 'valeu', 'agradecido', 'agradecida', 'ok', 'certo') then
    if v_tenant_id is not null
       and not exists (
         select 1
         from public.wa_conversations open_conversation
         where open_conversation.tenant_id = v_tenant_id
           and regexp_replace(open_conversation.chat_id, '\D', '', 'g') = any(v_phone_variants)
           and coalesce(open_conversation.is_closed, false) = false
       ) then
      select exists (
        select 1
        from public.wa_conversations completed
        where completed.tenant_id = v_tenant_id
          and regexp_replace(completed.chat_id, '\D', '', 'g') = any(v_phone_variants)
          and completed.is_closed = true
          and completed.payload_draft ->> 'module' = 'appointments'
          and coalesce(completed.last_message_at, completed.created_at) > now() - interval '2 hours'
      ) into v_recent_completed_appointment;
    end if;
  end if;

  if v_recent_completed_appointment then
    return jsonb_build_object(
      'ok', true,
      'route', 'tenant_post_appointment',
      'reason', 'appointment_gratitude_after_completion',
      'reply_text', 'Eu que agradeço! 😊 Seu agendamento em ' || v_tenant_name || ' está confirmado. Se precisar ajustar esse ou marcar outro horário, escolha Agendamentos. Para procurar outro estabelecimento, use o Menu do Jack.',
      'request_dispatch', false,
      'inbox_thread_id', p_inbox_thread_id,
      'inbox_routed', true,
      'tenant_id', v_tenant_id,
      'tenant_name', v_tenant_name,
      'tenant_plan', v_plan
    );
  end if;

  return public.admin_whatsapp_router_step_module_continuity(
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

comment on function public.whatsapp_is_explicit_human_handoff(text) is
  'Returns true only when a WhatsApp message explicitly asks for a human.';
