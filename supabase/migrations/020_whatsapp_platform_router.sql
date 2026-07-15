-- Institutional and tenant-aware routing for the Assistente Jack WhatsApp entrypoint.

create table if not exists public.platform_whatsapp_threads (
  id uuid primary key default gen_random_uuid(),
  customer_phone_e164 text not null unique,
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  assigned_admin_auth_user_id uuid references public.platform_admins(auth_user_id) on delete set null,
  last_message_preview text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.platform_whatsapp_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_type text not null check (sender_type in ('customer', 'bot', 'admin', 'system')),
  provider text not null default 'whatsapp_cloud',
  provider_message_id text,
  status text not null default 'received',
  body text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists platform_whatsapp_messages_provider_message_idx
on public.platform_whatsapp_messages(provider_message_id)
where provider_message_id is not null;

create index if not exists platform_whatsapp_threads_activity_idx
on public.platform_whatsapp_threads(status, last_message_at desc);

create index if not exists platform_whatsapp_messages_thread_created_idx
on public.platform_whatsapp_messages(thread_id, created_at);

alter table public.platform_whatsapp_threads enable row level security;
alter table public.platform_whatsapp_messages enable row level security;

create policy platform_whatsapp_threads_read_platform_admin
on public.platform_whatsapp_threads for select to authenticated
using (exists (
  select 1 from public.platform_admins pa
  where pa.auth_user_id = auth.uid() and pa.is_active = true
));

create policy platform_whatsapp_messages_read_platform_admin
on public.platform_whatsapp_messages for select to authenticated
using (exists (
  select 1 from public.platform_admins pa
  where pa.auth_user_id = auth.uid() and pa.is_active = true
));

grant select on public.platform_whatsapp_threads, public.platform_whatsapp_messages to authenticated;
grant select, insert, update, delete on public.platform_whatsapp_threads, public.platform_whatsapp_messages to service_role;

create or replace function public.admin_record_platform_whatsapp_inbound(
  p_customer_phone_e164 text,
  p_message_id text,
  p_body text,
  p_raw_event jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_thread_id uuid;
  v_now timestamptz := now();
begin
  if v_phone = '' or trim(coalesce(p_body, '')) = '' then
    return null;
  end if;

  insert into public.platform_whatsapp_threads (
    customer_phone_e164, status, last_message_preview, last_message_at,
    last_inbound_at, unread_count, updated_at
  ) values (
    v_phone, 'open', left(trim(p_body), 240), v_now, v_now, 1, v_now
  )
  on conflict (customer_phone_e164) do update set
    status = 'open',
    last_message_preview = excluded.last_message_preview,
    last_message_at = excluded.last_message_at,
    last_inbound_at = excluded.last_inbound_at,
    unread_count = public.platform_whatsapp_threads.unread_count + 1,
    updated_at = v_now
  returning id into v_thread_id;

  insert into public.platform_whatsapp_messages (
    thread_id, direction, sender_type, provider, provider_message_id,
    status, body, raw_payload, created_at
  ) values (
    v_thread_id, 'inbound', 'customer', 'whatsapp_cloud',
    nullif(trim(coalesce(p_message_id, '')), ''), 'received', trim(p_body),
    coalesce(p_raw_event, '{}'::jsonb), v_now
  )
  on conflict (provider_message_id) where provider_message_id is not null do nothing;

  return v_thread_id;
end;
$$;

revoke all on function public.admin_record_platform_whatsapp_inbound(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_record_platform_whatsapp_inbound(text, text, text, jsonb) to service_role;

create table if not exists public.platform_whatsapp_router_sessions (
  customer_phone_e164 text primary key,
  step text not null default 'platform_menu'
    check (step in ('platform_menu', 'tenant_search_query', 'tenant_search_choice', 'platform_human_handoff')),
  candidate_tenant_ids uuid[] not null default '{}'::uuid[],
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_whatsapp_router_sessions enable row level security;
revoke all on public.platform_whatsapp_router_sessions from anon, authenticated;
grant select, insert, update, delete on public.platform_whatsapp_router_sessions to service_role;

insert into public.tenant_message_templates (tenant_id, template_key, channel, content, is_active)
select t.id, 'tenant_welcome', 'whatsapp',
       'Olá! Eu sou o Assistente Jack, de {{tenant_name}}. Como posso ajudar?', true
from public.tenants t
on conflict (tenant_id, template_key) do nothing;

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
  v_message text := regexp_replace(trim(coalesce(p_message, '')), '\s+', ' ', 'g');
  v_text text;
  v_session public.platform_whatsapp_router_sessions%rowtype;
  v_tenant_id uuid;
  v_thread_id uuid;
  v_tenant_name text;
  v_plan text;
  v_welcome text;
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
  v_platform_menu constant text := E'Olá! Sou o Assistente Jack, da Meu Assistente Virtual. Como posso ajudar?\n\n1 - Quero me cadastrar\n2 - Conhecer os planos disponíveis\n3 - Procurar um serviço ou produto de um cliente\n4 - Falar com atendimento humano';
begin
  v_text := lower(v_message);

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

    if v_text in ('0', 'menu', 'inicio', 'início', 'voltar') then
      insert into public.platform_whatsapp_router_sessions
        (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
      values (v_phone, 'platform_menu', '{}'::uuid[], '{}'::jsonb, now())
      on conflict (customer_phone_e164) do update
        set step = excluded.step, candidate_tenant_ids = excluded.candidate_tenant_ids,
            payload = excluded.payload, updated_at = now();
      return jsonb_build_object('ok', true, 'route', 'platform_menu',
        'reason', 'platform_menu_reset', 'reply_text', v_platform_menu,
        'request_dispatch', false);
    end if;

    if v_session.step = 'tenant_search_query' then
      if char_length(v_message) < 2 then
        return jsonb_build_object('ok', true, 'route', 'tenant_search',
          'reply_text', E'Digite pelo menos 2 letras do nome do negócio.\n\nDigite 0 para voltar.',
          'request_dispatch', false);
      end if;

      select coalesce(array_agg(x.id order by x.legal_name), '{}'::uuid[]),
             coalesce(array_agg(x.legal_name order by x.legal_name), '{}'::text[])
      into v_candidate_ids, v_candidate_names
      from (
        select id, legal_name from public.tenants
        where status = 'active' and legal_name ilike '%' || v_message || '%'
        order by legal_name limit 5
      ) x;

      if cardinality(v_candidate_ids) = 0 then
        return jsonb_build_object('ok', true, 'route', 'tenant_search',
          'reply_text', 'Não encontrei um cliente ativo com esse nome. Tente outro nome ou digite 0 para voltar.',
          'request_dispatch', false);
      end if;

      update public.platform_whatsapp_router_sessions
      set step = 'tenant_search_choice', candidate_tenant_ids = v_candidate_ids,
          payload = jsonb_build_object('query', v_message), updated_at = now()
      where customer_phone_e164 = v_phone;

      select E'Encontrei estas opções:\n\n' ||
             string_agg(format('%s - %s', u.ordinality, u.name), E'\n') ||
             E'\n\nResponda com o número desejado ou digite 0 para voltar.'
      into v_reply from unnest(v_candidate_names) with ordinality as u(name, ordinality);

      return jsonb_build_object('ok', true, 'route', 'tenant_search_results',
        'reply_text', v_reply, 'request_dispatch', false,
        'tenant_candidates', to_jsonb(v_candidate_names));
    end if;

    if v_session.step = 'tenant_search_choice' then
      begin v_choice := v_text::integer;
      exception when invalid_text_representation then v_choice := null;
      end;

      if v_choice is null or v_choice < 1 or v_choice > cardinality(v_session.candidate_tenant_ids) then
        return jsonb_build_object('ok', true, 'route', 'tenant_search_results',
          'reply_text', 'Escolha pelo número ou digite 0 para voltar.', 'request_dispatch', false);
      end if;

      v_tenant_id := v_session.candidate_tenant_ids[v_choice];
      if not exists (select 1 from public.tenants where id = v_tenant_id and status = 'active') then
        delete from public.platform_whatsapp_router_sessions where customer_phone_e164 = v_phone;
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reply_text', E'Esse negócio não está disponível.\n\n' || v_platform_menu,
          'request_dispatch', false);
      end if;

      update public.tenant_whatsapp_threads set status = 'closed', updated_at = now()
      where status = 'open' and tenant_id <> v_tenant_id
        and regexp_replace(customer_phone_e164, '\D', '', 'g') = v_phone;

      insert into public.tenant_whatsapp_threads
        (tenant_id, customer_phone_e164, status, last_message_preview,
         last_message_at, last_inbound_at, unread_count, updated_at)
      values (v_tenant_id, v_phone, 'open', left(v_message, 240), now(), now(), 1, now())
      on conflict (tenant_id, customer_phone_e164) do update
        set status = 'open', last_message_preview = excluded.last_message_preview,
            last_message_at = excluded.last_message_at, last_inbound_at = excluded.last_inbound_at,
            unread_count = public.tenant_whatsapp_threads.unread_count + 1, updated_at = now()
      returning id into v_thread_id;

      insert into public.tenant_whatsapp_messages
        (thread_id, tenant_id, direction, sender_type, provider, provider_message_id,
         status, body, raw_payload, created_at)
      values (v_thread_id, v_tenant_id, 'inbound', 'customer', 'whatsapp_cloud',
        nullif(trim(coalesce(p_message_id, '')), ''), 'received', v_message,
        jsonb_build_object('source', 'platform_tenant_search_selection'), now())
      on conflict (provider_message_id) where provider_message_id is not null do nothing;

      delete from public.platform_whatsapp_router_sessions where customer_phone_e164 = v_phone;
      v_newly_bound := true;
    else
      if v_text = '1' or v_text like '%cadastr%' then
        return jsonb_build_object('ok', true, 'route', 'platform_signup',
          'reply_text', E'Para cadastrar seu negócio e usar o Assistente Jack, acesse:\nhttps://www.meuassistentevirtual.com.br/cadastro\n\nDigite 0 para voltar.',
          'request_dispatch', false);
      elsif v_text = '2' or v_text like '%plano%' then
        return jsonb_build_object('ok', true, 'route', 'platform_plans',
          'reply_text', E'Conheça nossos planos:\n\n• Cobranças: clientes, mensalidades e lembretes pelo WhatsApp.\n• Agenda: agendamentos, remarcações e cancelamentos pelo WhatsApp.\n• Completo: cobranças e agenda em uma única operação.\n• Catálogo e pedidos: produtos, pedidos e acompanhamento financeiro.\n\nDigite 0 para voltar.',
          'request_dispatch', false);
      elsif v_text = '3' or v_text like '%serviço%' or v_text like '%servico%'
         or v_text like '%produto%' or v_text like '%cliente%' then
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'tenant_search_query', '{}'::uuid[], '{}'::jsonb, now())
        on conflict (customer_phone_e164) do update
          set step = excluded.step, candidate_tenant_ids = excluded.candidate_tenant_ids,
              payload = excluded.payload, updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'tenant_search',
          'reply_text', E'Deseja algum serviço ou produto de um dos nossos clientes? É só me dizer o nome do negócio que você procura.\n\nDigite 0 para voltar.',
          'request_dispatch', false);
      elsif v_text = '4' or v_text like '%human%' or v_text like '%atendente%' or v_text like '%atendimento%' then
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'platform_human_handoff', '{}'::uuid[], jsonb_build_object('requested_at', now()), now())
        on conflict (customer_phone_e164) do update
          set step = excluded.step, payload = excluded.payload, updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'platform_human_handoff',
          'reply_text', 'Certo. Sua conversa foi encaminhada para o atendimento humano da Meu Assistente Virtual.',
          'request_dispatch', false);
      else
        insert into public.platform_whatsapp_router_sessions
          (customer_phone_e164, step, candidate_tenant_ids, payload, updated_at)
        values (v_phone, 'platform_menu', '{}'::uuid[], '{}'::jsonb, now())
        on conflict (customer_phone_e164) do update set updated_at = now();
        return jsonb_build_object('ok', true, 'route', 'platform_menu',
          'reply_text', v_platform_menu, 'request_dispatch', false);
      end if;
    end if;
  end if;

  select t.legal_name, t.plan,
         coalesce(nullif(trim(mt.content), ''),
           'Olá! Eu sou o Assistente Jack, de {{tenant_name}}. Como posso ajudar?')
  into v_tenant_name, v_plan, v_welcome
  from public.tenants t
  left join public.tenant_message_templates mt
    on mt.tenant_id = t.id and mt.template_key = 'tenant_welcome'
   and mt.channel = 'whatsapp' and mt.is_active = true
  where t.id = v_tenant_id and t.status = 'active';

  v_welcome := replace(v_welcome, '{{tenant_name}}', coalesce(v_tenant_name, 'nossa equipe'));
  if v_plan = 'plan1' then
    v_menu := E'1 - Cadastro ou mensalidades\n2 - Falar com atendimento humano';
  elsif v_plan = 'plan2' then
    v_menu := E'1 - Agendar, remarcar ou cancelar agendamento\n2 - Falar com atendimento humano';
  elsif v_plan = 'plan3' then
    v_menu := E'1 - Agendar, remarcar ou cancelar agendamento\n2 - Cadastro ou mensalidades\n3 - Falar com atendimento humano';
  else
    v_menu := '1 - Falar com atendimento humano';
  end if;

  if v_newly_bound or v_text in ('', '0', 'menu', 'inicio', 'início', 'jack', 'ola', 'olá', 'oi') then
    v_reply := v_welcome || E'\n\n' || v_menu;
    v_route := 'tenant_menu'; v_reason := 'show_tenant_menu';
  elsif v_plan = 'plan1' and (v_text = '1' or v_text like '%mensal%' or v_text like '%cadastro%') then
    v_route := 'billing_signup'; v_reason := 'tenant_billing_selected';
    v_target_workflow := 'WA_TENANT_BILLING_SIGNUP_INBOUND_v1';
    v_target_path := 'wa-tenant-billing-signup-inbound-v1'; v_dispatch := true;
  elsif v_plan in ('plan2', 'plan3') and (v_text = '1' or v_text like '%agend%'
     or v_text like '%remarc%' or v_text like '%cancel%') then
    v_route := 'appointments'; v_reason := 'tenant_appointments_selected';
    v_target_workflow := 'WA_TENANT_APPOINTMENTS_INBOUND_v1';
    v_target_path := 'wa-tenant-appointments-inbound-v1'; v_dispatch := true;
  elsif v_plan = 'plan3' and (v_text = '2' or v_text like '%mensal%' or v_text like '%cadastro%') then
    v_route := 'billing_signup'; v_reason := 'tenant_billing_selected';
    v_target_workflow := 'WA_TENANT_BILLING_SIGNUP_INBOUND_v1';
    v_target_path := 'wa-tenant-billing-signup-inbound-v1'; v_dispatch := true;
  elsif v_text like '%human%' or v_text like '%atend%'
     or (v_plan in ('plan1', 'plan2') and v_text = '2')
     or (v_plan = 'plan3' and v_text = '3')
     or (v_plan not in ('plan1', 'plan2', 'plan3') and v_text = '1') then
    v_route := 'tenant_human_handoff'; v_reason := 'tenant_human_handoff_requested';
    v_reply := 'Certo. Sua conversa foi encaminhada para o atendimento humano de ' || v_tenant_name || '.';
  else
    v_route := 'tenant_menu'; v_reason := 'tenant_menu_invalid_choice';
    v_reply := E'Não entendi sua escolha.\n\n' || v_welcome || E'\n\n' || v_menu;
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
