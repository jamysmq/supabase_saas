drop function if exists public.jsonb_deep_merge(jsonb, jsonb);

create or replace function public.jsonb_deep_merge(left_value jsonb, right_value jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(
      coalesce(left_entry.key, right_entry.key),
      case
        when jsonb_typeof(left_entry.value) = 'object'
          and jsonb_typeof(right_entry.value) = 'object'
          then public.jsonb_deep_merge(left_entry.value, right_entry.value)
        else coalesce(right_entry.value, left_entry.value)
      end
    ),
    '{}'::jsonb
  )
  from jsonb_each(coalesce(left_value, '{}'::jsonb)) left_entry
  full join jsonb_each(coalesce(right_value, '{}'::jsonb)) right_entry
    on left_entry.key = right_entry.key;
$$;

create or replace function public.wa_appointment_load_or_create_context(
  p_tenant_id uuid default null,
  p_tenant_phone_e164 text default null,
  p_chat_id text default null,
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
  services jsonb,
  staff_members jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_chat_id text;
  v_conversation_id uuid;
  v_step text;
  v_payload jsonb;
begin
  v_chat_id := nullif(trim(coalesce(p_chat_id, '')), '');

  if v_chat_id is null then
    raise exception 'chat_id_required';
  end if;

  if p_tenant_id is not null then
    select t.id
      into v_tenant_id
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.plan in ('plan2', 'plan3');
  end if;

  if v_tenant_id is null and nullif(trim(coalesce(p_tenant_phone_e164, '')), '') is not null then
    select r.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_routing r
    where regexp_replace(r.phone_e164, '\D', '', 'g') = regexp_replace(p_tenant_phone_e164, '\D', '', 'g')
      and r.is_active = true
      and r.plan in ('plan2', 'plan3')
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
      and t.plan in ('plan2', 'plan3')
    limit 1;
  end if;

  if v_tenant_id is null then
    raise exception 'tenant_not_found_or_plan_without_appointments';
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
      'appointment_welcome',
      public.jsonb_deep_merge(
        jsonb_build_object(
          'version', 1,
          'module', 'appointments',
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
    coalesce(mt.content, 'Ola! Eu sou o Assistente Jack, de {{tenant_name}}. Me diga o servico e o melhor dia para voce.'),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'name', s.name,
          'description', s.description,
          'duration_minutes', s.duration_minutes,
          'price_cents', s.price_cents,
          'staff_member_ids', coalesce((
            select jsonb_agg(link.staff_member_id order by sm.name)
            from public.tenant_service_staff_members link
            join public.tenant_staff_members sm
              on sm.id = link.staff_member_id
             and sm.tenant_id = link.tenant_id
             and sm.is_active = true
            where link.tenant_id = s.tenant_id
              and link.service_id = s.id
          ), '[]'::jsonb)
        )
        order by s.name
      )
      from public.tenant_services s
      where s.tenant_id = t.id
        and s.is_active = true
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', sm.id,
          'name', sm.name,
          'role', sm.role
        )
        order by sm.name
      )
      from public.tenant_staff_members sm
      where sm.tenant_id = t.id
        and sm.is_active = true
    ), '[]'::jsonb)
  from public.tenants t
  left join public.tenant_message_templates mt
    on mt.tenant_id = t.id
   and mt.template_key = 'appointment_welcome'
   and mt.channel = 'whatsapp'
   and mt.is_active = true
  where t.id = v_tenant_id;
end;
$$;

create or replace function public.wa_appointment_conversation_patch(
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
  set
    step = coalesce(nullif(trim(p_step), ''), c.step),
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

create or replace function public.wa_appointment_create_external(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_service_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
begin
  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.plan in ('plan2', 'plan3')
  ) then
    raise exception 'tenant_not_found_or_plan_without_appointments';
  end if;

  if p_service_id is null then
    raise exception 'service_required';
  end if;

  if p_staff_member_id is null then
    raise exception 'staff_member_required';
  end if;

  if not exists (
    select 1
    from public.tenant_service_staff_members link
    join public.tenant_services s
      on s.id = link.service_id
     and s.tenant_id = link.tenant_id
     and s.is_active = true
    join public.tenant_staff_members sm
      on sm.id = link.staff_member_id
     and sm.tenant_id = link.tenant_id
     and sm.is_active = true
    where link.tenant_id = p_tenant_id
      and link.service_id = p_service_id
      and link.staff_member_id = p_staff_member_id
  ) then
    raise exception 'service_staff_member_not_linked';
  end if;

  if p_staff_member_id is not null and exists (
    select 1
    from public.appointments a
    where a.tenant_id = p_tenant_id
      and a.staff_member_id = p_staff_member_id
      and a.deleted_at is null
      and a.status not in ('cancelled', 'no_show')
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'appointment_time_unavailable';
  end if;

  v_appointment_id := public.admin_create_external_appointment(
    p_tenant_id,
    p_full_name,
    p_cpf,
    p_whatsapp_e164,
    p_birth_date,
    p_service_id,
    p_staff_member_id,
    p_starts_at,
    p_ends_at,
    p_title,
    p_notes,
    'whatsapp'
  );

  insert into public.appointment_status_events (
    appointment_id,
    tenant_id,
    old_status,
    new_status,
    source,
    note
  )
  values (
    v_appointment_id,
    p_tenant_id,
    null,
    'scheduled',
    'whatsapp',
    'Agendamento criado pelo workflow WhatsApp.'
  );

  return v_appointment_id;
end;
$$;

grant execute on function public.jsonb_deep_merge(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.wa_appointment_load_or_create_context(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.wa_appointment_conversation_patch(uuid, text, jsonb, boolean) to authenticated, service_role;
grant execute on function public.wa_appointment_create_external(uuid, text, text, text, date, uuid, uuid, timestamptz, timestamptz, text, text) to authenticated, service_role;

create table if not exists public.appointment_reminder_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reminder_key text not null,
  channel text not null default 'whatsapp',
  recipient_e164 text,
  rendered_message text,
  sent_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create unique index if not exists appointment_reminder_events_appointment_key_uidx
on public.appointment_reminder_events (appointment_id, reminder_key);

create index if not exists appointment_reminder_events_tenant_sent_idx
on public.appointment_reminder_events (tenant_id, sent_at desc);

alter table public.appointment_reminder_events enable row level security;

grant select
on public.appointment_reminder_events
to authenticated;

grant select, insert, update, delete
on public.appointment_reminder_events
to service_role;

drop policy if exists "appointment_reminder_events_read_own_tenant" on public.appointment_reminder_events;
create policy "appointment_reminder_events_read_own_tenant"
on public.appointment_reminder_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = appointment_reminder_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

insert into public.tenant_message_templates (
  tenant_id,
  template_key,
  channel,
  content,
  is_active
)
select
  t.id,
  'appointment_confirmation_reminder',
  'whatsapp',
  'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Confirmando seu horario em {{appointment_date}} as {{appointment_time}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.',
  true
from public.tenants t
where t.plan in ('plan2', 'plan3')
  and not exists (
    select 1
    from public.tenant_message_templates mt
    where mt.tenant_id = t.id
      and mt.template_key = 'appointment_confirmation_reminder'
  );

create or replace function public.wa_appointment_list_confirmation_reminders(
  p_run_date date default current_date,
  p_timezone text default 'America/Fortaleza'
)
returns table (
  appointment_id uuid,
  tenant_id uuid,
  tenant_name text,
  customer_name text,
  customer_phone_e164 text,
  service_name text,
  staff_member_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  appointment_date text,
  appointment_time text,
  message_template text
)
language sql
security definer
set search_path = public
as $$
  select
    a.id as appointment_id,
    a.tenant_id,
    t.legal_name as tenant_name,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone_e164,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    a.starts_at,
    a.ends_at,
    to_char(a.starts_at at time zone p_timezone, 'DD/MM/YYYY') as appointment_date,
    to_char(a.starts_at at time zone p_timezone, 'HH24:MI') as appointment_time,
    coalesce(
      mt.content,
      'Ola, {{customer_name}}! Aqui e o Assistente Jack, de {{tenant_name}}. Confirmando seu horario em {{appointment_date}} as {{appointment_time}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.'
    ) as message_template
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  left join public.tenant_message_templates mt
    on mt.tenant_id = a.tenant_id
   and mt.template_key = 'appointment_confirmation_reminder'
   and mt.channel = 'whatsapp'
   and mt.is_active = true
  where t.status = 'active'
    and t.plan in ('plan2', 'plan3')
    and a.status = 'scheduled'
    and a.deleted_at is null
    and (a.starts_at at time zone p_timezone)::date = p_run_date + 1
    and coalesce(tc.phone_e164, ec.whatsapp_e164, '') <> ''
    and not exists (
      select 1
      from public.appointment_reminder_events are
      where are.appointment_id = a.id
        and are.reminder_key = 'appointment_d1_09'
    )
  order by a.starts_at asc;
$$;

create or replace function public.wa_appointment_mark_confirmation_reminder_sent(
  p_appointment_id uuid,
  p_rendered_message text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_recipient text;
  v_service_id uuid;
  v_staff_member_id uuid;
  v_service_name text;
  v_staff_member_name text;
  v_duration_minutes integer;
  v_customer_birth_date date;
begin
  select
    a.tenant_id,
    coalesce(tc.phone_e164, ec.whatsapp_e164),
    a.service_id,
    a.staff_member_id,
    coalesce(a.service_name_snapshot, s.name),
    coalesce(a.staff_member_name_snapshot, sm.name),
    s.duration_minutes,
    coalesce(tc.birth_date, ec.birth_date)
    into v_tenant_id, v_recipient, v_service_id, v_staff_member_id, v_service_name, v_staff_member_name, v_duration_minutes, v_customer_birth_date
  from public.appointments a
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.id = p_appointment_id;

  if v_tenant_id is null then
    raise exception 'appointment_not_found';
  end if;

  insert into public.appointment_reminder_events (
    appointment_id,
    tenant_id,
    reminder_key,
    channel,
    recipient_e164,
    rendered_message,
    payload
  )
  values (
    p_appointment_id,
    v_tenant_id,
    'appointment_d1_09',
    'whatsapp',
    v_recipient,
    p_rendered_message,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (appointment_id, reminder_key)
  do update set
    rendered_message = excluded.rendered_message,
    payload = excluded.payload,
    sent_at = now();

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
    regexp_replace(coalesce(v_recipient, ''), '\D', '', 'g'),
    'appointment_confirmation_action',
    jsonb_build_object(
      'version', 1,
      'module', 'appointments',
      'appointment', jsonb_build_object(
        'appointment_id', p_appointment_id,
        'customer_whatsapp', regexp_replace(coalesce(v_recipient, ''), '\D', '', 'g'),
        'service_id', v_service_id,
        'service_name', v_service_name,
        'staff_member_id', v_staff_member_id,
        'staff_member_name', v_staff_member_name,
        'duration_minutes', v_duration_minutes,
        'customer_birth_date', v_customer_birth_date
      ),
      'metadata', jsonb_build_object(
        'source', 'appointment_d1_09',
        'reminder_sent_at', now()
      )
    ),
    false,
    now()
  )
  on conflict do nothing;
end;
$$;

create or replace function public.wa_appointment_apply_customer_action(
  p_appointment_id uuid,
  p_action text,
  p_new_starts_at timestamptz default null,
  p_new_ends_at timestamptz default null,
  p_note text default null
)
returns table (
  appointment_id uuid,
  old_status text,
  new_status text,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment record;
  v_action text;
  v_new_status text;
begin
  v_action := lower(trim(coalesce(p_action, '')));

  select *
    into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.deleted_at is null;

  if v_appointment.id is null then
    raise exception 'appointment_not_found';
  end if;

  if not exists (
    select 1
    from public.tenants t
    where t.id = v_appointment.tenant_id
      and t.status = 'active'
      and t.plan in ('plan2', 'plan3')
  ) then
    raise exception 'tenant_not_found_or_plan_without_appointments';
  end if;

  if v_action in ('confirm', 'confirmed', 'confirmar', '1') then
    v_new_status := 'confirmed';

    update public.appointments
    set status = v_new_status,
        updated_at = now()
    where id = p_appointment_id;
  elsif v_action in ('cancel', 'cancelled', 'cancelar', '3') then
    v_new_status := 'cancelled';

    update public.appointments
    set status = v_new_status,
        cancelled_at = now(),
        updated_at = now()
    where id = p_appointment_id;
  elsif v_action in ('reschedule', 'remarcar', '2') then
    if p_new_starts_at is null or p_new_ends_at is null or p_new_ends_at <= p_new_starts_at then
      raise exception 'invalid_reschedule_time';
    end if;

    if v_appointment.staff_member_id is not null and exists (
      select 1
      from public.appointments a
      where a.tenant_id = v_appointment.tenant_id
        and a.id <> p_appointment_id
        and a.staff_member_id = v_appointment.staff_member_id
        and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_new_starts_at, p_new_ends_at, '[)')
    ) then
      raise exception 'appointment_time_unavailable';
    end if;

    v_new_status := 'scheduled';

    update public.appointments
    set starts_at = p_new_starts_at,
        ends_at = p_new_ends_at,
        status = v_new_status,
        cancelled_at = null,
        updated_at = now()
    where id = p_appointment_id;
  else
    raise exception 'invalid_customer_action';
  end if;

  insert into public.appointment_status_events (
    appointment_id,
    tenant_id,
    old_status,
    new_status,
    source,
    note
  )
  values (
    p_appointment_id,
    v_appointment.tenant_id,
    v_appointment.status,
    v_new_status,
    'whatsapp',
    coalesce(p_note, 'Alteracao feita pelo cliente via WhatsApp.')
  );

  perform public.admin_sync_appointment_service_revenue(p_appointment_id, 'whatsapp');

  return query
  select
    a.id,
    v_appointment.status,
    a.status,
    a.starts_at,
    a.ends_at
  from public.appointments a
  where a.id = p_appointment_id;
end;
$$;

grant execute on function public.wa_appointment_list_confirmation_reminders(date, text) to authenticated, service_role;
grant execute on function public.wa_appointment_mark_confirmation_reminder_sent(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.wa_appointment_apply_customer_action(uuid, text, timestamptz, timestamptz, text) to authenticated, service_role;

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
  with service_config as (
    select s.duration_minutes
    from public.tenant_services s
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and s.is_active = true
  ),
  settings_config as (
    select
      coalesce(tas.opens_at, time '08:00') as opens_at,
      coalesce(tas.closes_at, time '18:00') as closes_at,
      coalesce(tas.has_break, false) as has_break,
      tas.break_starts_at,
      tas.break_duration_minutes
    from (select p_tenant_id as tenant_id) tenant_scope
    left join public.tenant_appointment_settings tas
      on tas.tenant_id = tenant_scope.tenant_id
  ),
  period_config as (
    select
      case lower(coalesce(p_period, 'any'))
        when 'morning' then greatest(sc.opens_at, time '08:00')
        when 'manha' then greatest(sc.opens_at, time '08:00')
        when 'afternoon' then greatest(sc.opens_at, time '12:00')
        when 'tarde' then greatest(sc.opens_at, time '12:00')
        when 'night' then greatest(sc.opens_at, time '18:00')
        when 'noite' then greatest(sc.opens_at, time '18:00')
        else sc.opens_at
      end as starts_at,
      case lower(coalesce(p_period, 'any'))
        when 'morning' then least(sc.closes_at, time '12:00')
        when 'manha' then least(sc.closes_at, time '12:00')
        when 'afternoon' then least(sc.closes_at, time '18:00')
        when 'tarde' then least(sc.closes_at, time '18:00')
        when 'night' then sc.closes_at
        when 'noite' then sc.closes_at
        else sc.closes_at
      end as ends_at,
      sc.has_break,
      sc.break_starts_at,
      sc.break_duration_minutes
    from settings_config sc
  ),
  staff_candidates as (
    select sm.id, sm.name
    from public.tenant_staff_members sm
    join public.tenant_service_staff_members link
      on link.staff_member_id = sm.id
     and link.tenant_id = sm.tenant_id
     and link.service_id = p_service_id
    where sm.tenant_id = p_tenant_id
      and sm.is_active = true
      and (p_staff_member_id is null or sm.id = p_staff_member_id)
  ),
  candidate_slots as (
    select
      (slot_start.slot_local at time zone p_timezone) as starts_at,
      ((slot_start.slot_local + make_interval(mins => service_config.duration_minutes)) at time zone p_timezone) as ends_at,
      staff_candidates.id as staff_member_id,
      staff_candidates.name as staff_member_name
    from service_config
    cross join period_config pc
    cross join staff_candidates
    cross join generate_series(
      greatest(coalesce(p_from_date, current_date), current_date)::timestamp,
      (current_date + greatest(1, least(coalesce(p_days_ahead, 60), 60)))::timestamp,
      interval '1 day'
    ) as day_series(day_local)
    cross join lateral (
      select generate_series(
        day_series.day_local + pc.starts_at,
        day_series.day_local + pc.ends_at - make_interval(mins => service_config.duration_minutes),
        interval '30 minutes'
      ) as slot_local
    ) slot_start
    where pc.ends_at > pc.starts_at
      and (slot_start.slot_local at time zone p_timezone) > now()
      and not (
        pc.has_break
        and pc.break_starts_at is not null
        and pc.break_duration_minutes is not null
        and tstzrange(
          slot_start.slot_local at time zone p_timezone,
          (slot_start.slot_local + make_interval(mins => service_config.duration_minutes)) at time zone p_timezone,
          '[)'
        ) && tstzrange(
          (day_series.day_local + pc.break_starts_at) at time zone p_timezone,
          (day_series.day_local + pc.break_starts_at + make_interval(mins => pc.break_duration_minutes)) at time zone p_timezone,
          '[)'
        )
      )
  ),
  available_slots as (
    select candidate_slots.*
    from candidate_slots
    where not exists (
      select 1
      from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show')
        and candidate_slots.staff_member_id = a.staff_member_id
        and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(candidate_slots.starts_at, candidate_slots.ends_at, '[)')
    )
  ),
  ranked_slots as (
    select
      available_slots.*,
      row_number() over (
        partition by available_slots.starts_at
        order by available_slots.staff_member_name nulls last
      ) as staff_rank
    from available_slots
  ),
  compact_slots as (
    select *
    from ranked_slots
    where staff_rank = 1
    order by starts_at asc, staff_member_name nulls last
    limit greatest(1, least(coalesce(p_limit, 5), 8))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    row_number() over (order by compact_slots.starts_at asc)::integer as slot_number,
    compact_slots.starts_at,
    compact_slots.ends_at,
    concat(
      to_char(compact_slots.starts_at at time zone p_timezone, 'Dy DD/MM'),
      ' as ',
      to_char(compact_slots.starts_at at time zone p_timezone, 'HH24:MI'),
      case
        when compact_slots.staff_member_name is null then ''
        else concat(' com ', compact_slots.staff_member_name)
      end
    ) as label,
    compact_slots.staff_member_id,
    compact_slots.staff_member_name
  from compact_slots;
$$;

grant execute on function public.wa_appointment_suggest_slots(uuid, uuid, uuid, date, text, integer, integer, integer, text) to authenticated, service_role;
