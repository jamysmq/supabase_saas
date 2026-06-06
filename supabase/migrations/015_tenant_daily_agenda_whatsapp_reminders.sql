create table if not exists public.tenant_daily_agenda_reminder_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reminder_date date not null,
  reminder_key text not null default 'tenant_daily_agenda_before_open',
  channel text not null default 'whatsapp',
  recipient_e164 text,
  rendered_message text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists tenant_daily_agenda_reminder_events_uidx
on public.tenant_daily_agenda_reminder_events (tenant_id, reminder_date, reminder_key);

create index if not exists tenant_daily_agenda_reminder_events_tenant_sent_idx
on public.tenant_daily_agenda_reminder_events (tenant_id, sent_at desc);

alter table public.tenant_daily_agenda_reminder_events enable row level security;

drop policy if exists "tenant_daily_agenda_reminder_events_read_own_tenant"
on public.tenant_daily_agenda_reminder_events;

create policy "tenant_daily_agenda_reminder_events_read_own_tenant"
on public.tenant_daily_agenda_reminder_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_daily_agenda_reminder_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

grant select on public.tenant_daily_agenda_reminder_events to authenticated;
grant select, insert, update, delete on public.tenant_daily_agenda_reminder_events to service_role;

create or replace function public.wa_tenant_daily_agenda_list_due_reminders(
  p_now timestamptz default now(),
  p_window_minutes integer default 15
)
returns table (
  tenant_id uuid,
  tenant_name text,
  recipient_e164 text,
  reminder_date date,
  opens_at time,
  timezone text,
  appointment_count integer,
  rendered_message text,
  payload jsonb
)
language sql
security definer
set search_path = public
as $$
  with tenant_scope as (
    select
      t.id as tenant_id,
      t.legal_name as tenant_name,
      regexp_replace(coalesce(t.whatsapp_e164, ''), '\D', '', 'g') as recipient_e164,
      coalesce(tas.opens_at, time '08:00') as opens_at,
      coalesce(nullif(tas.timezone, ''), 'America/Fortaleza') as timezone
    from public.tenants t
    left join public.tenant_appointment_settings tas
      on tas.tenant_id = t.id
    where t.status = 'active'
      and t.plan in ('plan2', 'plan3')
      and regexp_replace(coalesce(t.whatsapp_e164, ''), '\D', '', 'g') <> ''
  ),
  due_tenants as (
    select
      ts.*,
      (p_now at time zone ts.timezone)::date as reminder_date,
      ((p_now at time zone ts.timezone)::date + ts.opens_at - interval '30 minutes') as reminder_local_at,
      (p_now at time zone ts.timezone) as now_local_at
    from tenant_scope ts
  ),
  appointments_by_tenant as (
    select
      dt.tenant_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'appointment_id', a.id,
            'time', to_char(a.starts_at at time zone dt.timezone, 'HH24:MI'),
            'customer_name', coalesce(tc.full_name, ec.full_name, a.title, 'Sem nome'),
            'customer_phone', coalesce(tc.phone_e164, ec.whatsapp_e164),
            'service_name', coalesce(a.service_name_snapshot, s.name),
            'staff_member_name', coalesce(a.staff_member_name_snapshot, sm.name),
            'status', a.status
          )
          order by a.starts_at asc
        ) filter (where a.id is not null),
        '[]'::jsonb
      ) as appointments
    from due_tenants dt
    left join public.appointments a
      on a.tenant_id = dt.tenant_id
     and a.deleted_at is null
     and a.status not in ('cancelled', 'no_show')
     and (a.starts_at at time zone dt.timezone)::date = dt.reminder_date
    left join public.tenant_customers tc on tc.id = a.tenant_customer_id
    left join public.end_customers ec on ec.id = a.end_customer_id
    left join public.tenant_services s on s.id = a.service_id
    left join public.tenant_staff_members sm on sm.id = a.staff_member_id
    group by dt.tenant_id
  )
  select
    dt.tenant_id,
    dt.tenant_name,
    dt.recipient_e164,
    dt.reminder_date,
    dt.opens_at,
    dt.timezone,
    jsonb_array_length(coalesce(abt.appointments, '[]'::jsonb))::integer as appointment_count,
    concat(
      'Bom dia! Agenda de hoje (',
      to_char(dt.reminder_date, 'DD/MM'),
      ') - ',
      dt.tenant_name,
      E'\n\n',
      case
        when jsonb_array_length(coalesce(abt.appointments, '[]'::jsonb)) = 0 then
          'Nenhum agendamento marcado para hoje.'
        else (
          select string_agg(
            concat(
              ordinality,
              ') ',
              appointment->>'time',
              ' - ',
              coalesce(nullif(appointment->>'customer_name', ''), 'Sem nome'),
              case
                when nullif(appointment->>'service_name', '') is null then ''
                else concat(' - ', appointment->>'service_name')
              end,
              case
                when nullif(appointment->>'staff_member_name', '') is null then ''
                else concat(' com ', appointment->>'staff_member_name')
              end
            ),
            E'\n'
            order by ordinality
          )
          from jsonb_array_elements(coalesce(abt.appointments, '[]'::jsonb)) with ordinality as item(appointment, ordinality)
        )
      end,
      E'\n\n',
      'Total: ',
      jsonb_array_length(coalesce(abt.appointments, '[]'::jsonb)),
      ' agendamento(s).'
    ) as rendered_message,
    jsonb_build_object(
      'tenant_id', dt.tenant_id,
      'tenant_name', dt.tenant_name,
      'reminder_date', dt.reminder_date,
      'opens_at', dt.opens_at,
      'timezone', dt.timezone,
      'appointments', coalesce(abt.appointments, '[]'::jsonb)
    ) as payload
  from due_tenants dt
  left join appointments_by_tenant abt
    on abt.tenant_id = dt.tenant_id
  where dt.now_local_at >= dt.reminder_local_at
    and dt.now_local_at < dt.reminder_local_at + make_interval(mins => greatest(1, least(coalesce(p_window_minutes, 15), 60)))
    and not exists (
      select 1
      from public.tenant_daily_agenda_reminder_events event
      where event.tenant_id = dt.tenant_id
        and event.reminder_date = dt.reminder_date
        and event.reminder_key = 'tenant_daily_agenda_before_open'
    )
  order by dt.opens_at asc, dt.tenant_name asc;
$$;

create or replace function public.wa_tenant_daily_agenda_mark_reminder_sent(
  p_tenant_id uuid,
  p_reminder_date date,
  p_recipient_e164 text,
  p_rendered_message text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then
    raise exception 'tenant_id_required';
  end if;

  if p_reminder_date is null then
    raise exception 'reminder_date_required';
  end if;

  insert into public.tenant_daily_agenda_reminder_events (
    tenant_id,
    reminder_date,
    reminder_key,
    channel,
    recipient_e164,
    rendered_message,
    payload,
    sent_at
  )
  values (
    p_tenant_id,
    p_reminder_date,
    'tenant_daily_agenda_before_open',
    'whatsapp',
    regexp_replace(coalesce(p_recipient_e164, ''), '\D', '', 'g'),
    p_rendered_message,
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  on conflict (tenant_id, reminder_date, reminder_key)
  do update set
    recipient_e164 = excluded.recipient_e164,
    rendered_message = excluded.rendered_message,
    payload = excluded.payload,
    sent_at = excluded.sent_at;
end;
$$;

grant execute on function public.wa_tenant_daily_agenda_list_due_reminders(timestamptz, integer) to authenticated, service_role;
grant execute on function public.wa_tenant_daily_agenda_mark_reminder_sent(uuid, date, text, text, jsonb) to authenticated, service_role;
