-- Adds recurring working weekdays to appointment settings and availability.

alter table public.tenant_appointment_settings
add column if not exists working_weekdays smallint[] not null
default array[1, 2, 3, 4, 5]::smallint[];

alter table public.tenant_appointment_settings
drop constraint if exists tenant_appointment_settings_working_weekdays_check;

alter table public.tenant_appointment_settings
add constraint tenant_appointment_settings_working_weekdays_check
check (
  cardinality(working_weekdays) between 1 and 7
  and working_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
);

comment on column public.tenant_appointment_settings.working_weekdays is
  'ISO weekdays when the business accepts appointments: Monday=1 through Sunday=7.';

create or replace function public.wa_appointment_suggest_slots_base(
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
  slot_number integer, starts_at timestamptz, ends_at timestamptz,
  label text, staff_member_id uuid, staff_member_name text
)
language sql
security definer
set search_path = public
as $$
  with service_config as (
    select s.duration_minutes
    from public.tenant_services s
    where s.id = p_service_id and s.tenant_id = p_tenant_id and s.is_active = true
  ),
  settings_config as (
    select coalesce(tas.opens_at, time '08:00') as opens_at,
      coalesce(tas.closes_at, time '18:00') as closes_at,
      coalesce(tas.working_weekdays, array[1, 2, 3, 4, 5]::smallint[]) as working_weekdays,
      coalesce(tas.has_break, false) as has_break,
      tas.break_starts_at, tas.break_duration_minutes
    from (select p_tenant_id as tenant_id) tenant_scope
    left join public.tenant_appointment_settings tas on tas.tenant_id = tenant_scope.tenant_id
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
        else sc.opens_at end as starts_at,
      case lower(coalesce(p_period, 'any'))
        when 'morning' then least(sc.closes_at, time '12:00')
        when 'manha' then least(sc.closes_at, time '12:00')
        when 'afternoon' then least(sc.closes_at, time '18:00')
        when 'tarde' then least(sc.closes_at, time '18:00')
        when 'night' then sc.closes_at
        when 'noite' then sc.closes_at
        else sc.closes_at end as ends_at,
      sc.working_weekdays,
      sc.has_break, sc.break_starts_at, sc.break_duration_minutes
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
      and extract(isodow from day_series.day_local)::smallint = any(pc.working_weekdays)
      and (slot_start.slot_local at time zone p_timezone) > now()
      and not (
        pc.has_break and pc.break_starts_at is not null and pc.break_duration_minutes is not null
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
        and tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(candidate_slots.starts_at, candidate_slots.ends_at, '[)')
    )
    and not exists (
      select 1
      from public.tenant_appointment_blocks b
      where b.tenant_id = p_tenant_id
        and tstzrange(b.starts_at, b.ends_at, '[)') &&
            tstzrange(candidate_slots.starts_at, candidate_slots.ends_at, '[)')
    )
  ),
  ranked_slots as (
    select available_slots.*,
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
    row_number() over (order by compact_slots.starts_at asc)::integer,
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
    ),
    compact_slots.staff_member_id,
    compact_slots.staff_member_name
  from compact_slots;
$$;

create or replace function public.prevent_appointment_outside_working_days()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_should_check boolean := tg_op = 'INSERT';
  v_timezone text := 'America/Fortaleza';
  v_working_weekdays smallint[] := array[1, 2, 3, 4, 5]::smallint[];
  v_local_weekday smallint;
begin
  if tg_op = 'UPDATE' then
    v_should_check := new.tenant_id is distinct from old.tenant_id
      or new.starts_at is distinct from old.starts_at
      or (old.deleted_at is not null and new.deleted_at is null)
      or (old.status in ('cancelled', 'no_show') and new.status not in ('cancelled', 'no_show'));
  end if;

  if not v_should_check
     or new.deleted_at is not null
     or new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  select
    coalesce(nullif(trim(settings.timezone), ''), 'America/Fortaleza'),
    coalesce(settings.working_weekdays, array[1, 2, 3, 4, 5]::smallint[])
  into v_timezone, v_working_weekdays
  from (select new.tenant_id as tenant_id) scope
  left join public.tenant_appointment_settings settings
    on settings.tenant_id = scope.tenant_id;

  v_local_weekday := extract(isodow from new.starts_at at time zone v_timezone)::smallint;

  if not (v_local_weekday = any(v_working_weekdays)) then
    raise exception 'appointment_day_unavailable';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_prevent_non_working_day on public.appointments;
create trigger appointments_prevent_non_working_day
before insert or update of tenant_id, starts_at, status, deleted_at
on public.appointments
for each row execute function public.prevent_appointment_outside_working_days();

do $$
begin
  if to_regprocedure(
    'public.wa_tenant_daily_agenda_list_due_reminders_base(timestamptz,integer)'
  ) is null then
    alter function public.wa_tenant_daily_agenda_list_due_reminders(
      timestamptz, integer
    ) rename to wa_tenant_daily_agenda_list_due_reminders_base;
  end if;
end;
$$;

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
  select due.*
  from public.wa_tenant_daily_agenda_list_due_reminders_base(
    p_now,
    p_window_minutes
  ) due
  left join public.tenant_appointment_settings settings
    on settings.tenant_id = due.tenant_id
  where extract(isodow from due.reminder_date)::smallint = any(
    coalesce(settings.working_weekdays, array[1, 2, 3, 4, 5]::smallint[])
  );
$$;

revoke all on function public.wa_tenant_daily_agenda_list_due_reminders(timestamptz, integer)
from public, anon, authenticated;
grant execute on function public.wa_tenant_daily_agenda_list_due_reminders(timestamptz, integer)
to service_role;

