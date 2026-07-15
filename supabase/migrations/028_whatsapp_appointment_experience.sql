-- Improves repeat appointment sessions, period awareness, localized slot
-- labels and the response immediately after a completed appointment flow.

alter table public.wa_conversations
drop constraint if exists wa_conversations_chat_uq;

alter table public.wa_conversations
drop constraint if exists ux_wa_conversations_chat_id;

-- Some environments created this uniqueness rule as a standalone index
-- instead of a table constraint. Remove either representation before adding
-- the active-conversation-only index below.
drop index if exists public.wa_conversations_chat_uq;
drop index if exists public.ux_wa_conversations_chat_id;

create unique index if not exists wa_conversations_active_chat_uq
on public.wa_conversations (tenant_id, chat_id)
where coalesce(is_closed, false) = false;

create or replace function public.enrich_whatsapp_conversation_settings()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_opens_at time := time '08:00';
  v_closes_at time := time '18:00';
  v_timezone text := 'America/Fortaleza';
begin
  select coalesce(s.opens_at, time '08:00'),
         coalesce(s.closes_at, time '18:00'),
         coalesce(nullif(trim(s.timezone), ''), 'America/Fortaleza')
  into v_opens_at, v_closes_at, v_timezone
  from (select new.tenant_id as tenant_id) scope
  left join public.tenant_appointment_settings s on s.tenant_id = scope.tenant_id;

  new.payload_draft := jsonb_set(
    coalesce(new.payload_draft, '{}'::jsonb),
    '{appointment_settings}',
    jsonb_build_object(
      'opens_at', to_char(v_opens_at, 'HH24:MI'),
      'closes_at', to_char(v_closes_at, 'HH24:MI'),
      'timezone', v_timezone
    ),
    true
  );

  return new;
end;
$$;

drop trigger if exists wa_conversations_enrich_appointment_settings
on public.wa_conversations;

create trigger wa_conversations_enrich_appointment_settings
before insert or update on public.wa_conversations
for each row execute function public.enrich_whatsapp_conversation_settings();

-- Preserve the availability calculation from migration 026 and localize only
-- the customer-facing label, independent of the database locale.
do $$
begin
  if to_regprocedure(
    'public.wa_appointment_suggest_slots_base(uuid,uuid,uuid,date,text,integer,integer,integer,text)'
  ) is null then
    alter function public.wa_appointment_suggest_slots(
      uuid, uuid, uuid, date, text, integer, integer, integer, text
    ) rename to wa_appointment_suggest_slots_base;
  end if;
end;
$$;

create or replace function public.wa_appointment_suggest_slots(
  p_tenant_id uuid,
  p_service_id uuid,
  p_staff_member_id uuid default null,
  p_from_date date default current_date,
  p_period text default null,
  p_limit integer default 5,
  p_offset integer default 0,
  p_days_ahead integer default 60,
  p_timezone text default 'America/Fortaleza'
)
returns table (
  slot_number integer,
  starts_at timestamptz,
  ends_at timestamptz,
  label text,
  staff_member_id uuid,
  staff_member_name text
)
language sql
security definer
set search_path = public
as $$
  select
    slots.slot_number,
    slots.starts_at,
    slots.ends_at,
    concat(
      case extract(isodow from slots.starts_at at time zone p_timezone)::integer
        when 1 then 'Segunda-feira'
        when 2 then 'Terça-feira'
        when 3 then 'Quarta-feira'
        when 4 then 'Quinta-feira'
        when 5 then 'Sexta-feira'
        when 6 then 'Sábado'
        when 7 then 'Domingo'
      end,
      ', ',
      to_char(slots.starts_at at time zone p_timezone, 'DD/MM'),
      ' às ',
      to_char(slots.starts_at at time zone p_timezone, 'HH24:MI'),
      case
        when slots.staff_member_name is null then ''
        else concat(' com ', slots.staff_member_name)
      end
    ) as label,
    slots.staff_member_id,
    slots.staff_member_name
  from public.wa_appointment_suggest_slots_base(
    p_tenant_id,
    p_service_id,
    p_staff_member_id,
    p_from_date,
    p_period,
    p_limit,
    p_offset,
    p_days_ahead,
    p_timezone
  ) slots;
$$;

revoke all on function public.wa_appointment_suggest_slots(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) from public, anon;
grant execute on function public.wa_appointment_suggest_slots(
  uuid, uuid, uuid, date, text, integer, integer, integer, text
) to authenticated, service_role;

-- Add a contextual response after the module closes instead of showing the
-- tenant-entry greeting again when the customer only thanks the assistant.
do $$
begin
  if to_regprocedure(
    'public.admin_whatsapp_router_step_module_continuity(text,text,text,uuid)'
  ) is null then
    alter function public.admin_whatsapp_router_step(
      text, text, text, uuid
    ) rename to admin_whatsapp_router_step_module_continuity;
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
  v_text text := public.whatsapp_normalize_search_text(p_message);
  v_phone_variants text[] := public.whatsapp_phone_variants(p_customer_phone_e164);
  v_tenant_id uuid;
  v_tenant_name text;
  v_plan text;
  v_recent_completed_appointment boolean := false;
begin
  if p_inbox_thread_id is not null
     and v_text in ('obrigado', 'obrigada', 'valeu', 'agradecido', 'agradecida', 'ok', 'certo') then
    select th.tenant_id,
           coalesce(nullif(trim(t.public_name), ''), t.legal_name),
           t.plan
    into v_tenant_id, v_tenant_name, v_plan
    from public.tenant_whatsapp_threads th
    join public.tenants t on t.id = th.tenant_id
    where th.id = p_inbox_thread_id and t.status = 'active';

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
