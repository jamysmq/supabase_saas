-- Resilient tenant discovery with public names, aliases and explicit confirmation.

create extension if not exists pg_trgm with schema extensions;

alter table public.tenants add column if not exists public_name text;
alter table public.tenants add column if not exists search_aliases text[] not null default '{}'::text[];

update public.tenants
set public_name = legal_name
where nullif(trim(public_name), '') is null;

alter table public.platform_whatsapp_router_sessions
drop constraint if exists platform_whatsapp_router_sessions_step_check;

alter table public.platform_whatsapp_router_sessions
add constraint platform_whatsapp_router_sessions_step_check
check (step in (
  'platform_menu', 'tenant_search_query', 'tenant_search_choice',
  'tenant_search_confirmation', 'platform_human_handoff'
));

create or replace function public.whatsapp_normalize_search_text(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_value, '')),
      'áàãâäéèêëíìîïóòõôöúùûüç',
      'aaaaaeeeeiiiiooooouuuuc'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

create or replace function public.admin_bind_whatsapp_tenant(
  p_customer_phone_e164 text,
  p_tenant_id uuid,
  p_message text,
  p_message_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_thread_id uuid;
begin
  update public.tenant_whatsapp_threads set status = 'closed', updated_at = now()
  where status = 'open' and tenant_id <> p_tenant_id
    and regexp_replace(customer_phone_e164, '\D', '', 'g') = v_phone;

  insert into public.tenant_whatsapp_threads (
    tenant_id, customer_phone_e164, status, last_message_preview,
    last_message_at, last_inbound_at, unread_count, updated_at
  ) values (
    p_tenant_id, v_phone, 'open', left(trim(coalesce(p_message, '')), 240),
    now(), now(), 1, now()
  )
  on conflict (tenant_id, customer_phone_e164) do update set
    status = 'open', last_message_preview = excluded.last_message_preview,
    last_message_at = excluded.last_message_at, last_inbound_at = excluded.last_inbound_at,
    unread_count = public.tenant_whatsapp_threads.unread_count + 1, updated_at = now()
  returning id into v_thread_id;

  insert into public.tenant_whatsapp_messages (
    thread_id, tenant_id, direction, sender_type, provider, provider_message_id,
    status, body, raw_payload, created_at
  ) values (
    v_thread_id, p_tenant_id, 'inbound', 'customer', 'whatsapp_cloud',
    nullif(trim(coalesce(p_message_id, '')), ''), 'received', trim(coalesce(p_message, '')),
    jsonb_build_object('source', 'platform_tenant_search_confirmation'), now()
  )
  on conflict (provider_message_id) where provider_message_id is not null do nothing;

  return v_thread_id;
end;
$$;

revoke all on function public.admin_bind_whatsapp_tenant(text, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.admin_bind_whatsapp_tenant(text, uuid, text, text) to service_role;

create or replace function public.admin_whatsapp_router_step(
  p_customer_phone_e164 text,
  p_message text,
  p_message_id text default null,
  p_inbox_thread_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_message text := regexp_replace(trim(coalesce(p_message, '')), '\s+', ' ', 'g');
  v_text text := public.whatsapp_normalize_search_text(p_message);
  v_session public.platform_whatsapp_router_sessions%rowtype;
  v_tenant_id uuid;
  v_thread_id uuid;
  v_tenant_name text;
  v_plan text;
  v_menu text;
  v_reply text;
  v_candidate_ids uuid[] := '{}'::uuid[];
  v_candidate_names text[] := '{}'::text[];
  v_choice integer;
  v_newly_bound boolean := false;
  v_route text := 'platform_menu';
  v_reason text := 'show_platform_menu';
  v_target_workflow text;
  v_target_path text;
  v_dispatch boolean := false;
  v_platform_menu constant text := E'Olá! Eu sou o Jack, o seu assistente virtual. Como posso ajudar?';
begin
  if v_phone = '' then
    return jsonb_build_object('ok', false, 'route', 'invalid_customer_phone',
      'reply_text', 'Não consegui identificar seu WhatsApp. Tente novamente em alguns instantes.',
      'request_dispatch', false);
  end if;

  if p_inbox_thread_id is not null then
    select th.tenant_id, th.id into v_tenant_id, v_thread_id
    from public.tenant_whatsapp_threads th
    join public.tenants t on t.id = th.tenant_id
    where th.id = p_inbox_thread_id and t.status = 'active';
  end if;

  if v_tenant_id is null then
    select * into v_session from public.platform_whatsapp_router_sessions
    where customer_phone_e164 = v_phone;

    if v_text in ('0', 'menu', 'menu principal', 'inicio', 'voltar') then
      insert into public.platform_whatsapp_router_sessions
        (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
      values (v_phone, 'platform_menu', '{}'::uuid[], '{}'::jsonb, now())
      on conflict (customer_phone_e164) do update set
        step = excluded.step, candidate_tenant_ids = excluded.candidate_tenant_ids,
        payload = excluded.payload, updated_at = now();
      return jsonb_build_object('ok', true, 'route', 'platform_menu',
        'reason', 'platform_menu_reset', 'reply_text', v_platform_menu,
        'request_dispatch', false);
    end if;

    if v_session.step = 'tenant_search_query' then
      if char_length(v_text) < 2 then
        return jsonb_build_object('ok', true, 'route', 'tenant_search',
          'reply_text', 'Digite pelo menos 2 letras do nome do negócio.',
          'request_dispatch', false);
      end if;

      select coalesce(array_agg(x.id order by x.score desc, x.name), '{}'::uuid[]),
             coalesce(array_agg(x.name order by x.score desc, x.name), '{}'::text[])
      into v_candidate_ids, v_candidate_names
      from (
        select scored.id, scored.name, scored.score
        from (
          select t.id, coalesce(nullif(trim(t.public_name), ''), t.legal_name) as name,
            greatest(
              similarity(v_text, public.whatsapp_normalize_search_text(t.legal_name)),
              similarity(v_text, public.whatsapp_normalize_search_text(t.public_name)),
              coalesce((select max(similarity(v_text, public.whatsapp_normalize_search_text(a))) from unnest(t.search_aliases) a), 0),
              case when public.whatsapp_normalize_search_text(t.legal_name) like '%' || v_text || '%' then 1 else 0 end,
              case when public.whatsapp_normalize_search_text(t.public_name) like '%' || v_text || '%' then 1 else 0 end
            ) as score
          from public.tenants t
          where t.status = 'active'
        ) scored
        where scored.score >= 0.18
        order by scored.score desc, scored.name
        limit 5
      ) x;

      if cardinality(v_candidate_ids) = 0 then
        update public.platform_whatsapp_router_sessions set
          step = 'platform_menu', candidate_tenant_ids = '{}'::uuid[], payload = '{}'::jsonb,
          updated_at = now() where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reason', 'tenant_search_no_match',
          'reply_text', 'Desculpe, não encontrei um negócio parecido. Posso ajudar com outra coisa?',
          'request_dispatch', false);
      end if;

      if cardinality(v_candidate_ids) = 1 then
        update public.platform_whatsapp_router_sessions set
          step = 'tenant_search_confirmation', candidate_tenant_ids = v_candidate_ids,
          payload = jsonb_build_object('query', v_message, 'selected_name', v_candidate_names[1]),
          updated_at = now() where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'tenant_search_confirmation',
          'reason', 'single_similar_tenant',
          'reply_text', 'Você quis dizer ' || v_candidate_names[1] || '?',
          'request_dispatch', false);
      end if;

      update public.platform_whatsapp_router_sessions set
        step = 'tenant_search_choice', candidate_tenant_ids = v_candidate_ids,
        payload = jsonb_build_object('query', v_message), updated_at = now()
      where customer_phone_e164 = v_phone;

      return jsonb_build_object('ok', true, 'route', 'tenant_search_results',
        'reason', 'multiple_similar_tenants',
        'reply_text', 'Encontrei alguns negócios parecidos.',
        'request_dispatch', false, 'tenant_candidates', to_jsonb(v_candidate_names));
    end if;

    if v_session.step = 'tenant_search_choice' then
      select coalesce(array_agg(coalesce(nullif(trim(t.public_name), ''), t.legal_name) order by c.ordinality), '{}'::text[])
      into v_candidate_names
      from unnest(v_session.candidate_tenant_ids) with ordinality as c(id, ordinality)
      join public.tenants t on t.id = c.id and t.status = 'active';

      begin v_choice := v_text::integer;
      exception when invalid_text_representation then v_choice := null;
      end;
      if v_choice is null or v_choice < 1 or v_choice > cardinality(v_session.candidate_tenant_ids) then
        return jsonb_build_object('ok', true, 'route', 'tenant_search_results',
          'reply_text', 'Selecione uma das opções encontradas.', 'request_dispatch', false,
          'tenant_candidates', to_jsonb(v_candidate_names));
      end if;
      v_tenant_id := v_session.candidate_tenant_ids[v_choice];
      select coalesce(nullif(trim(public_name), ''), legal_name) into v_tenant_name
      from public.tenants where id = v_tenant_id and status = 'active';
      if v_tenant_name is null then
        delete from public.platform_whatsapp_router_sessions where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reason', 'tenant_unavailable', 'reply_text', 'Esse negócio não está disponível.',
          'request_dispatch', false);
      end if;
      update public.platform_whatsapp_router_sessions set
        step = 'tenant_search_confirmation', candidate_tenant_ids = array[v_tenant_id],
        payload = jsonb_build_object('selected_name', v_tenant_name), updated_at = now()
      where customer_phone_e164 = v_phone;
      return jsonb_build_object('ok', true, 'route', 'tenant_search_confirmation',
        'reason', 'confirm_selected_tenant', 'reply_text', 'Você deseja falar com ' || v_tenant_name || '?',
        'request_dispatch', false);
    end if;

    if v_session.step = 'tenant_search_confirmation' then
      if v_text in ('nao', 'n', 'negativo', 'outra opcao') then
        update public.platform_whatsapp_router_sessions set
          step = 'platform_menu', candidate_tenant_ids = '{}'::uuid[], payload = '{}'::jsonb,
          updated_at = now() where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reason', 'tenant_search_rejected',
          'reply_text', 'Tudo bem, desculpe pela confusão. Posso ajudar com outra coisa?',
          'request_dispatch', false);
      end if;
      if v_text not in ('sim', 's', 'confirmar', 'confirmo', 'isso') then
        return jsonb_build_object('ok', true, 'route', 'tenant_search_confirmation',
          'reply_text', 'Confirma esse negócio?', 'request_dispatch', false);
      end if;
      v_tenant_id := v_session.candidate_tenant_ids[1];
      if not exists (select 1 from public.tenants where id = v_tenant_id and status = 'active') then
        delete from public.platform_whatsapp_router_sessions where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reason', 'tenant_unavailable', 'reply_text', 'Esse negócio não está disponível.',
          'request_dispatch', false);
      end if;
      v_thread_id := public.admin_bind_whatsapp_tenant(v_phone, v_tenant_id, v_message, p_message_id);
      delete from public.platform_whatsapp_router_sessions where customer_phone_e164 = v_phone;
      v_newly_bound := true;
    else
      if v_text = '1' or v_text like '%cadastr%' then
        return jsonb_build_object('ok', true, 'route', 'platform_signup',
          'reply_text', E'Para ter o Jack no seu negócio, acesse:\nhttps://www.meuassistentevirtual.com.br/cadastro',
          'request_dispatch', false);
      elsif v_text = '2' or v_text like '%plano%' or v_text like '%conhecer%jack%' then
        return jsonb_build_object('ok', true, 'route', 'platform_plans',
          'reply_text', E'O Jack pode cuidar de cobranças, agenda, cadastro de clientes, catálogos e pedidos, conforme o plano escolhido.\n\nPara começar: https://www.meuassistentevirtual.com.br/cadastro',
          'request_dispatch', false);
      elsif v_text = '3' or v_text like '%servico%' or v_text like '%produto%' or v_text like '%negocio%' or v_text like '%cliente%' then
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'tenant_search_query', '{}'::uuid[], '{}'::jsonb, now())
        on conflict (customer_phone_e164) do update set
          step = excluded.step, candidate_tenant_ids = excluded.candidate_tenant_ids,
          payload = excluded.payload, updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'tenant_search',
          'reply_text', 'É só me dizer o nome do negócio que você procura.',
          'request_dispatch', false);
      elsif v_text = '4' or v_text like '%human%' or v_text like '%atend%' or v_text like '%pessoa%' then
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'platform_human_handoff', '{}'::uuid[], jsonb_build_object('requested_at', now()), now())
        on conflict (customer_phone_e164) do update set step = excluded.step, payload = excluded.payload, updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'platform_human_handoff',
          'reply_text', 'Certo. Encaminhei sua conversa para uma pessoa da nossa equipe.',
          'request_dispatch', false);
      else
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'platform_menu', '{}'::uuid[], '{}'::jsonb, now())
        on conflict (customer_phone_e164) do update set updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reason', 'show_platform_menu', 'reply_text', v_platform_menu, 'request_dispatch', false);
      end if;
    end if;
  end if;

  select coalesce(nullif(trim(t.public_name), ''), t.legal_name), t.plan
  into v_tenant_name, v_plan from public.tenants t
  where t.id = v_tenant_id and t.status = 'active';

  if v_plan = 'plan1' then
    v_menu := E'1 - Cadastro ou mensalidades\n2 - Falar com atendimento humano';
  elsif v_plan = 'plan2' then
    v_menu := E'1 - Agendar, remarcar ou cancelar agendamento\n2 - Falar com atendimento humano';
  elsif v_plan = 'plan3' then
    v_menu := E'1 - Agendar, remarcar ou cancelar agendamento\n2 - Cadastro ou mensalidades\n3 - Falar com atendimento humano';
  else
    v_menu := '1 - Falar com atendimento humano';
  end if;

  if v_newly_bound or v_text in ('', '0', 'menu', 'inicio', 'jack', 'ola', 'oi') then
    v_reply := 'Olá! Eu sou o Jack, o assistente virtual de ' || v_tenant_name || E'.\n\n' || v_menu;
    v_route := 'tenant_menu'; v_reason := 'show_tenant_menu';
  elsif v_plan = 'plan1' and (v_text = '1' or v_text like '%mensal%' or v_text like '%cadastro%') then
    v_route := 'billing_signup'; v_reason := 'tenant_billing_selected';
    v_target_workflow := 'WA_TENANT_BILLING_SIGNUP_INBOUND_v1'; v_target_path := 'wa-tenant-billing-signup-inbound-v1'; v_dispatch := true;
  elsif v_plan in ('plan2', 'plan3') and (v_text = '1' or v_text like '%agend%' or v_text like '%remarc%' or v_text like '%cancel%') then
    v_route := 'appointments'; v_reason := 'tenant_appointments_selected';
    v_target_workflow := 'WA_TENANT_APPOINTMENTS_INBOUND_v1'; v_target_path := 'wa-tenant-appointments-inbound-v1'; v_dispatch := true;
  elsif v_plan = 'plan3' and (v_text = '2' or v_text like '%mensal%' or v_text like '%cadastro%') then
    v_route := 'billing_signup'; v_reason := 'tenant_billing_selected';
    v_target_workflow := 'WA_TENANT_BILLING_SIGNUP_INBOUND_v1'; v_target_path := 'wa-tenant-billing-signup-inbound-v1'; v_dispatch := true;
  elsif v_text like '%atend%' or v_text like '%human%' then
    v_route := 'tenant_human_handoff'; v_reason := 'tenant_human_handoff_requested';
    v_reply := 'Certo. Encaminhei sua conversa para a equipe de ' || v_tenant_name || '.';
  else
    v_route := 'tenant_menu'; v_reason := 'tenant_menu_invalid_choice';
    v_reply := E'Não entendi sua escolha.\n\n' || v_menu;
  end if;

  return jsonb_build_object(
    'ok', true, 'route', v_route, 'reason', v_reason,
    'target_workflow', v_target_workflow, 'target_webhook_path', v_target_path,
    'request_dispatch', v_dispatch, 'reply_text', v_reply,
    'inbox_thread_id', v_thread_id, 'inbox_routed', v_thread_id is not null,
    'tenant_id', v_tenant_id, 'tenant_name', v_tenant_name, 'tenant_plan', v_plan
  );
end;
$$;

revoke all on function public.admin_whatsapp_router_step(text, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.admin_whatsapp_router_step(text, text, text, uuid) to service_role;
