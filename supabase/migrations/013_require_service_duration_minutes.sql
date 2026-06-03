update public.tenant_services
set duration_minutes = 60
where duration_minutes is null;

alter table public.tenant_services
  alter column duration_minutes drop default,
  alter column duration_minutes set not null;

alter table public.tenant_services
  drop constraint if exists tenant_services_duration_minutes_required_check;

alter table public.tenant_services
  add constraint tenant_services_duration_minutes_required_check
  check (duration_minutes between 15 and 480);

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
  period_config as (
    select
      case lower(coalesce(p_period, 'any'))
        when 'morning' then time '08:00'
        when 'manha' then time '08:00'
        when 'afternoon' then time '12:00'
        when 'tarde' then time '12:00'
        when 'night' then time '18:00'
        when 'noite' then time '18:00'
        else time '08:00'
      end as starts_at,
      case lower(coalesce(p_period, 'any'))
        when 'morning' then time '12:00'
        when 'manha' then time '12:00'
        when 'afternoon' then time '18:00'
        when 'tarde' then time '18:00'
        when 'night' then time '21:00'
        when 'noite' then time '21:00'
        else time '18:00'
      end as ends_at
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
      ((slot_start.slot_local + make_interval(mins => sc.duration_minutes)) at time zone p_timezone) as ends_at,
      staff_candidates.id as staff_member_id,
      staff_candidates.name as staff_member_name
    from service_config sc
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
        day_series.day_local + pc.ends_at - make_interval(mins => sc.duration_minutes),
        interval '30 minutes'
      ) as slot_local
    ) slot_start
    where (slot_start.slot_local at time zone p_timezone) > now()
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
        and (
          (candidate_slots.staff_member_id is null and a.staff_member_id is null)
          or (candidate_slots.staff_member_id is not null and a.staff_member_id = candidate_slots.staff_member_id)
        )
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
