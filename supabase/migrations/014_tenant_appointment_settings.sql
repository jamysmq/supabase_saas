create table if not exists public.tenant_appointment_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  opens_at time not null default time '08:00',
  closes_at time not null default time '18:00',
  has_break boolean not null default false,
  break_starts_at time,
  break_duration_minutes integer,
  timezone text not null default 'America/Fortaleza',
  updated_at timestamptz not null default now(),
  constraint tenant_appointment_settings_hours_check check (closes_at > opens_at),
  constraint tenant_appointment_settings_break_check check (
    (
      has_break = false
      and break_starts_at is null
      and break_duration_minutes is null
    )
    or (
      has_break = true
      and break_starts_at is not null
      and break_duration_minutes between 15 and 240
      and break_starts_at > opens_at
      and break_starts_at < closes_at
      and (
        (extract(hour from break_starts_at)::integer * 60) + extract(minute from break_starts_at)::integer + break_duration_minutes
      ) < (
        (extract(hour from closes_at)::integer * 60) + extract(minute from closes_at)::integer
      )
    )
  )
);

alter table public.tenant_appointment_settings
  drop constraint if exists tenant_appointment_settings_break_check;

alter table public.tenant_appointment_settings
  add constraint tenant_appointment_settings_break_check check (
    (
      has_break = false
      and break_starts_at is null
      and break_duration_minutes is null
    )
    or (
      has_break = true
      and break_starts_at is not null
      and break_duration_minutes between 15 and 240
      and break_starts_at > opens_at
      and break_starts_at < closes_at
      and (
        (extract(hour from break_starts_at)::integer * 60) + extract(minute from break_starts_at)::integer + break_duration_minutes
      ) < (
        (extract(hour from closes_at)::integer * 60) + extract(minute from closes_at)::integer
      )
    )
  );

alter table public.tenant_appointment_settings enable row level security;

drop policy if exists "tenant_appointment_settings_service_role_all" on public.tenant_appointment_settings;
create policy "tenant_appointment_settings_service_role_all"
on public.tenant_appointment_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "tenant_appointment_settings_manage_own_tenant" on public.tenant_appointment_settings;
create policy "tenant_appointment_settings_manage_own_tenant"
on public.tenant_appointment_settings
for all
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_appointment_settings.tenant_id
      and tu.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_appointment_settings.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.tenant_appointment_settings to authenticated, service_role;

insert into public.tenant_appointment_settings (tenant_id)
select t.id
from public.tenants t
where t.plan in ('plan2', 'plan3')
on conflict (tenant_id) do nothing;

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
