-- Allow a customer to choose a longer continuous rental while keeping the
-- resource duration as the default/minimum billable block.

drop function if exists public.wa_appointment_suggest_resource_slots(
  uuid, uuid, date, text, integer, integer, integer, text
);

create function public.wa_appointment_suggest_resource_slots(
  p_tenant_id uuid,
  p_bookable_resource_id uuid,
  p_from_date date default current_date,
  p_period text default null,
  p_limit integer default 5,
  p_offset integer default 0,
  p_days_ahead integer default 60,
  p_timezone text default 'America/Fortaleza',
  p_duration_minutes integer default null
)
returns table (
  slot_number integer,
  starts_at timestamptz,
  ends_at timestamptz,
  label text,
  bookable_resource_id uuid,
  bookable_resource_name text,
  duration_minutes integer,
  total_price_cents integer
)
language sql
security definer
set search_path = public
as $$
  with resource_config as (
    select
      resource.id,
      resource.name,
      resource.duration_minutes as default_duration_minutes,
      coalesce(p_duration_minutes, resource.duration_minutes) as requested_duration_minutes,
      resource.price_cents
    from public.tenant_bookable_resources resource
    join public.tenants tenant on tenant.id = resource.tenant_id
    where resource.id = p_bookable_resource_id
      and resource.tenant_id = p_tenant_id
      and resource.is_active = true
      and tenant.status = 'active'
      and tenant.plan = 'plan3'
      and tenant.resource_booking_plus_enabled = true
      and coalesce(p_duration_minutes, resource.duration_minutes)
        between resource.duration_minutes and 480
      and (
        p_duration_minutes is null
        or mod(p_duration_minutes, 30) = 0
      )
  ),
  settings_config as (
    select
      coalesce(settings.opens_at, time '08:00') as opens_at,
      coalesce(settings.closes_at, time '18:00') as closes_at,
      coalesce(settings.working_weekdays, array[1,2,3,4,5]::smallint[]) as working_weekdays,
      coalesce(settings.has_break, false) as has_break,
      settings.break_starts_at,
      settings.break_duration_minutes
    from (select p_tenant_id as tenant_id) scope
    left join public.tenant_appointment_settings settings
      on settings.tenant_id = scope.tenant_id
  ),
  period_config as (
    select
      case lower(coalesce(p_period, 'any'))
        when 'morning' then greatest(config.opens_at, time '08:00')
        when 'manha' then greatest(config.opens_at, time '08:00')
        when 'afternoon' then greatest(config.opens_at, time '12:00')
        when 'tarde' then greatest(config.opens_at, time '12:00')
        when 'night' then greatest(config.opens_at, time '18:00')
        when 'noite' then greatest(config.opens_at, time '18:00')
        else config.opens_at
      end as starts_at,
      case lower(coalesce(p_period, 'any'))
        when 'morning' then least(config.closes_at, time '12:00')
        when 'manha' then least(config.closes_at, time '12:00')
        when 'afternoon' then least(config.closes_at, time '18:00')
        when 'tarde' then least(config.closes_at, time '18:00')
        else config.closes_at
      end as ends_at,
      config.working_weekdays,
      config.has_break,
      config.break_starts_at,
      config.break_duration_minutes
    from settings_config config
  ),
  candidates as (
    select
      resource.id as resource_id,
      resource.name as resource_name,
      resource.requested_duration_minutes,
      case
        when resource.price_cents is null then null
        else round(
          resource.price_cents::numeric
          * resource.requested_duration_minutes
          / resource.default_duration_minutes
        )::integer
      end as total_price_cents,
      slot.slot_local at time zone p_timezone as starts_at,
      (
        slot.slot_local
        + make_interval(mins => resource.requested_duration_minutes)
      ) at time zone p_timezone as ends_at
    from resource_config resource
    cross join period_config period
    cross join generate_series(
      greatest(coalesce(p_from_date, current_date), current_date)::timestamp,
      (current_date + greatest(1, least(coalesce(p_days_ahead, 60), 60)))::timestamp,
      interval '1 day'
    ) day(day_local)
    cross join lateral (
      select generate_series(
        day.day_local + period.starts_at,
        day.day_local + period.ends_at
          - make_interval(mins => resource.requested_duration_minutes),
        interval '30 minutes'
      ) slot_local
    ) slot
    where period.ends_at > period.starts_at
      and extract(isodow from day.day_local)::smallint = any(period.working_weekdays)
      and slot.slot_local at time zone p_timezone > now()
      and not (
        period.has_break
        and period.break_starts_at is not null
        and period.break_duration_minutes is not null
        and tstzrange(
          slot.slot_local at time zone p_timezone,
          (
            slot.slot_local
            + make_interval(mins => resource.requested_duration_minutes)
          ) at time zone p_timezone,
          '[)'
        ) && tstzrange(
          (day.day_local + period.break_starts_at) at time zone p_timezone,
          (
            day.day_local
            + period.break_starts_at
            + make_interval(mins => period.break_duration_minutes)
          ) at time zone p_timezone,
          '[)'
        )
      )
  ),
  available as (
    select candidate.*
    from candidates candidate
    where not exists (
      select 1
      from public.appointments appointment
      where appointment.tenant_id = p_tenant_id
        and appointment.bookable_resource_id = candidate.resource_id
        and appointment.deleted_at is null
        and appointment.status not in ('cancelled', 'no_show')
        and tstzrange(appointment.starts_at, appointment.ends_at, '[)') &&
          tstzrange(candidate.starts_at, candidate.ends_at, '[)')
    )
    and not exists (
      select 1
      from public.tenant_appointment_blocks block
      where block.tenant_id = p_tenant_id
        and tstzrange(block.starts_at, block.ends_at, '[)') &&
          tstzrange(candidate.starts_at, candidate.ends_at, '[)')
    )
    order by candidate.starts_at
    limit greatest(1, least(coalesce(p_limit, 5), 8))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    row_number() over (order by available.starts_at)::integer,
    available.starts_at,
    available.ends_at,
    concat(
      case extract(isodow from available.starts_at at time zone p_timezone)::integer
        when 1 then 'Segunda-feira'
        when 2 then 'Terça-feira'
        when 3 then 'Quarta-feira'
        when 4 then 'Quinta-feira'
        when 5 then 'Sexta-feira'
        when 6 then 'Sábado'
        when 7 then 'Domingo'
      end,
      ', ',
      to_char(available.starts_at at time zone p_timezone, 'DD/MM'),
      ' às ',
      to_char(available.starts_at at time zone p_timezone, 'HH24:MI'),
      '–',
      to_char(available.ends_at at time zone p_timezone, 'HH24:MI')
    ),
    available.resource_id,
    available.resource_name,
    available.requested_duration_minutes,
    available.total_price_cents
  from available;
$$;

revoke all on function public.wa_appointment_suggest_resource_slots(
  uuid, uuid, date, text, integer, integer, integer, text, integer
) from public, anon, authenticated;

grant execute on function public.wa_appointment_suggest_resource_slots(
  uuid, uuid, date, text, integer, integer, integer, text, integer
) to service_role;
