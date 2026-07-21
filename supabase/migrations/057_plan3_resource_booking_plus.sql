-- Plan 3 Plus: bookable courts/environments, charged at R$ 79.90/month.
-- Plan 3 additional professionals cost R$ 50.00/month after the first one.

alter table public.tenants
drop constraint if exists tenants_business_type_check;

alter table public.tenants
add constraint tenants_business_type_check
check (business_type in (
  'teacher', 'autonomous', 'clinic', 'salon', 'restaurant',
  'loja_material', 'petshop', 'arena', 'academy'
));

alter table public.tenants
add column if not exists resource_booking_plus_enabled boolean not null default false;

alter table public.tenants
drop constraint if exists tenants_resource_booking_plus_plan_check;

alter table public.tenants
add constraint tenants_resource_booking_plus_plan_check
check (resource_booking_plus_enabled = false or plan = 'plan3');

alter table public.platform_tenant_billing_profiles
add column if not exists resource_booking_plus_amount_cents integer not null default 0;

alter table public.platform_tenant_billing_profiles
drop constraint if exists platform_tenant_billing_profiles_resource_plus_check;

alter table public.platform_tenant_billing_profiles
add constraint platform_tenant_billing_profiles_resource_plus_check
check (resource_booking_plus_amount_cents in (0, 7990));

alter table public.tenant_staff_addition_requests
drop constraint if exists tenant_staff_addition_requests_amount_check;

alter table public.tenant_staff_addition_requests
add constraint tenant_staff_addition_requests_amount_check
check (additional_amount_cents in (2500, 5000));

create table if not exists public.tenant_bookable_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  kind text not null default 'court',
  description text,
  duration_minutes integer not null default 60,
  price_cents integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_bookable_resources_name_check
    check (char_length(trim(name)) between 1 and 120),
  constraint tenant_bookable_resources_kind_check
    check (kind in ('court', 'environment')),
  constraint tenant_bookable_resources_duration_check
    check (duration_minutes between 15 and 480),
  constraint tenant_bookable_resources_price_check
    check (price_cents is null or price_cents >= 0)
);

create index if not exists tenant_bookable_resources_tenant_active_idx
on public.tenant_bookable_resources(tenant_id, is_active, name);

alter table public.tenant_bookable_resources enable row level security;

drop policy if exists tenant_bookable_resources_service_role_all
on public.tenant_bookable_resources;
create policy tenant_bookable_resources_service_role_all
on public.tenant_bookable_resources for all to service_role
using (true) with check (true);

drop policy if exists tenant_bookable_resources_manage_own_tenant
on public.tenant_bookable_resources;
create policy tenant_bookable_resources_manage_own_tenant
on public.tenant_bookable_resources for all to authenticated
using (exists (
  select 1 from public.tenant_users tenant_user
  where tenant_user.tenant_id = tenant_bookable_resources.tenant_id
    and tenant_user.auth_user_id = auth.uid()
))
with check (exists (
  select 1 from public.tenant_users tenant_user
  where tenant_user.tenant_id = tenant_bookable_resources.tenant_id
    and tenant_user.auth_user_id = auth.uid()
));

grant select, insert, update, delete on public.tenant_bookable_resources
to authenticated, service_role;

alter table public.appointments
add column if not exists bookable_resource_id uuid
  references public.tenant_bookable_resources(id) on delete set null;

alter table public.appointments
add column if not exists bookable_resource_name_snapshot text;

create index if not exists appointments_tenant_resource_starts_idx
on public.appointments(tenant_id, bookable_resource_id, starts_at)
where bookable_resource_id is not null and deleted_at is null;

create or replace function public.enforce_appointment_service_staff_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.service_id is not distinct from old.service_id
     and new.staff_member_id is not distinct from old.staff_member_id
     and new.bookable_resource_id is not distinct from old.bookable_resource_id then
    return new;
  end if;

  if new.bookable_resource_id is not null then
    if new.service_id is not null or new.staff_member_id is not null then
      raise exception 'mixed_service_and_resource_booking';
    end if;

    if not exists (
      select 1
      from public.tenant_bookable_resources resource
      join public.tenants tenant on tenant.id = resource.tenant_id
      where resource.id = new.bookable_resource_id
        and resource.tenant_id = new.tenant_id
        and resource.is_active = true
        and tenant.status = 'active'
        and tenant.plan = 'plan3'
        and tenant.resource_booking_plus_enabled = true
    ) then
      raise exception 'bookable_resource_not_found_or_plus_disabled';
    end if;

    return new;
  end if;

  -- ON DELETE SET NULL keeps historical service appointments readable.
  if tg_op = 'UPDATE'
     and old.staff_member_id is not null
     and new.staff_member_id is null
     and new.service_id is not distinct from old.service_id
     and nullif(trim(coalesce(new.staff_member_name_snapshot, '')), '') is not null then
    return new;
  end if;

  if new.service_id is null then raise exception 'service_required'; end if;
  if new.staff_member_id is null then raise exception 'staff_member_required'; end if;

  if not exists (
    select 1
    from public.tenant_service_staff_members link
    where link.tenant_id = new.tenant_id
      and link.service_id = new.service_id
      and link.staff_member_id = new.staff_member_id
  ) then
    raise exception 'service_staff_member_not_linked';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_bookable_resource_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bookable_resource_id is null
     or new.deleted_at is not null
     or new.status in ('cancelled', 'no_show') then
    return new;
  end if;

  if exists (
    select 1
    from public.appointments appointment
    where appointment.tenant_id = new.tenant_id
      and appointment.bookable_resource_id = new.bookable_resource_id
      and appointment.id <> new.id
      and appointment.deleted_at is null
      and appointment.status not in ('cancelled', 'no_show')
      and tstzrange(appointment.starts_at, appointment.ends_at, '[)') &&
          tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'bookable_resource_time_unavailable';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_prevent_resource_overlap on public.appointments;
create trigger appointments_prevent_resource_overlap
before insert or update of tenant_id, bookable_resource_id, starts_at, ends_at, status, deleted_at
on public.appointments
for each row execute function public.prevent_bookable_resource_overlap();

create or replace function public.admin_create_external_resource_appointment(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_bookable_resource_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text default null,
  p_notes text default null,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_end_customer_id uuid;
  v_appointment_id uuid;
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_whatsapp text := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');
  v_resource_name text;
begin
  if length(v_whatsapp) in (10, 11) then v_whatsapp := '55' || v_whatsapp; end if;
  if nullif(trim(p_full_name), '') is null then raise exception 'customer_name_required'; end if;
  if length(v_cpf) <> 11 then raise exception 'invalid_customer_cpf'; end if;
  if length(v_whatsapp) not in (12, 13) or left(v_whatsapp, 2) <> '55' then
    raise exception 'invalid_customer_whatsapp';
  end if;
  if p_birth_date is null then raise exception 'customer_birth_date_required'; end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'invalid_appointment_time';
  end if;

  select resource.name into v_resource_name
  from public.tenant_bookable_resources resource
  join public.tenants tenant on tenant.id = resource.tenant_id
  where resource.id = p_bookable_resource_id
    and resource.tenant_id = p_tenant_id
    and resource.is_active = true
    and tenant.status = 'active'
    and tenant.plan = 'plan3'
    and tenant.resource_booking_plus_enabled = true;

  if v_resource_name is null then
    raise exception 'bookable_resource_not_found_or_plus_disabled';
  end if;

  insert into public.end_customers (
    tenant_id, full_name, cpf, email, birth_date, whatsapp_e164, blocked
  ) values (
    p_tenant_id, trim(p_full_name), v_cpf, '', p_birth_date, v_whatsapp, false
  )
  on conflict (tenant_id, cpf) where cpf is not null and cpf <> ''
  do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    whatsapp_e164 = excluded.whatsapp_e164,
    blocked = false
  returning id into v_end_customer_id;

  insert into public.appointments (
    tenant_id, end_customer_id, bookable_resource_id,
    bookable_resource_name_snapshot, starts_at, ends_at, status,
    title, notes, source
  ) values (
    p_tenant_id, v_end_customer_id, p_bookable_resource_id,
    v_resource_name, p_starts_at, p_ends_at, 'scheduled',
    coalesce(nullif(trim(p_title), ''), 'Aluguel de ' || v_resource_name),
    nullif(trim(p_notes), ''), coalesce(nullif(trim(p_source), ''), 'panel')
  ) returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

create or replace function public.wa_appointment_create_resource_external(
  p_tenant_id uuid,
  p_full_name text,
  p_cpf text,
  p_whatsapp_e164 text,
  p_birth_date date,
  p_bookable_resource_id uuid,
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
declare v_appointment_id uuid;
begin
  v_appointment_id := public.admin_create_external_resource_appointment(
    p_tenant_id, p_full_name, p_cpf, p_whatsapp_e164, p_birth_date,
    p_bookable_resource_id, p_starts_at, p_ends_at, p_title, p_notes, 'whatsapp'
  );

  insert into public.appointment_status_events (
    appointment_id, tenant_id, old_status, new_status, source, note
  ) values (
    v_appointment_id, p_tenant_id, null, 'scheduled', 'whatsapp',
    'Aluguel de quadra/ambiente criado pelo workflow WhatsApp.'
  );

  return v_appointment_id;
end;
$$;

create or replace function public.wa_appointment_suggest_resource_slots(
  p_tenant_id uuid,
  p_bookable_resource_id uuid,
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
  bookable_resource_id uuid,
  bookable_resource_name text
)
language sql
security definer
set search_path = public
as $$
  with resource_config as (
    select resource.id, resource.name, resource.duration_minutes
    from public.tenant_bookable_resources resource
    join public.tenants tenant on tenant.id = resource.tenant_id
    where resource.id = p_bookable_resource_id
      and resource.tenant_id = p_tenant_id
      and resource.is_active = true
      and tenant.status = 'active'
      and tenant.plan = 'plan3'
      and tenant.resource_booking_plus_enabled = true
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
    left join public.tenant_appointment_settings settings on settings.tenant_id = scope.tenant_id
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
        else config.opens_at end as starts_at,
      case lower(coalesce(p_period, 'any'))
        when 'morning' then least(config.closes_at, time '12:00')
        when 'manha' then least(config.closes_at, time '12:00')
        when 'afternoon' then least(config.closes_at, time '18:00')
        when 'tarde' then least(config.closes_at, time '18:00')
        else config.closes_at end as ends_at,
      config.working_weekdays, config.has_break,
      config.break_starts_at, config.break_duration_minutes
    from settings_config config
  ),
  candidates as (
    select
      resource.id as resource_id,
      resource.name as resource_name,
      slot.slot_local at time zone p_timezone as starts_at,
      (slot.slot_local + make_interval(mins => resource.duration_minutes)) at time zone p_timezone as ends_at
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
        day.day_local + period.ends_at - make_interval(mins => resource.duration_minutes),
        interval '30 minutes'
      ) slot_local
    ) slot
    where period.ends_at > period.starts_at
      and extract(isodow from day.day_local)::smallint = any(period.working_weekdays)
      and slot.slot_local at time zone p_timezone > now()
      and not (
        period.has_break and period.break_starts_at is not null
        and period.break_duration_minutes is not null
        and tstzrange(
          slot.slot_local at time zone p_timezone,
          (slot.slot_local + make_interval(mins => resource.duration_minutes)) at time zone p_timezone,
          '[)'
        ) && tstzrange(
          (day.day_local + period.break_starts_at) at time zone p_timezone,
          (day.day_local + period.break_starts_at + make_interval(mins => period.break_duration_minutes)) at time zone p_timezone,
          '[)'
        )
      )
  ),
  available as (
    select candidate.*
    from candidates candidate
    where not exists (
      select 1 from public.appointments appointment
      where appointment.tenant_id = p_tenant_id
        and appointment.bookable_resource_id = candidate.resource_id
        and appointment.deleted_at is null
        and appointment.status not in ('cancelled', 'no_show')
        and tstzrange(appointment.starts_at, appointment.ends_at, '[)') &&
            tstzrange(candidate.starts_at, candidate.ends_at, '[)')
    )
    and not exists (
      select 1 from public.tenant_appointment_blocks block
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
        when 1 then 'Segunda-feira' when 2 then 'Terça-feira'
        when 3 then 'Quarta-feira' when 4 then 'Quinta-feira'
        when 5 then 'Sexta-feira' when 6 then 'Sábado' when 7 then 'Domingo'
      end,
      ', ', to_char(available.starts_at at time zone p_timezone, 'DD/MM'),
      ' às ', to_char(available.starts_at at time zone p_timezone, 'HH24:MI')
    ),
    available.resource_id,
    available.resource_name
  from available;
$$;

create or replace function public.wa_appointment_load_or_create_context_v2(
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
  staff_members jsonb,
  upcoming_appointments jsonb,
  bookable_resources jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    base.conversation_id,
    base.tenant_id,
    base.tenant_name,
    base.tenant_plan,
    base.tenant_business_type,
    base.step,
    base.payload_draft,
    base.welcome_message,
    base.services,
    base.staff_members,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_id', appointment.id,
        'starts_at', appointment.starts_at,
        'ends_at', appointment.ends_at,
        'label', concat(
          to_char(appointment.starts_at at time zone 'America/Fortaleza', 'DD/MM'),
          ' às ', to_char(appointment.starts_at at time zone 'America/Fortaleza', 'HH24:MI'),
          case when appointment.bookable_resource_id is not null
            then ' - ' || coalesce(appointment.bookable_resource_name_snapshot, resource.name)
            else ' - ' || coalesce(appointment.service_name_snapshot, service.name, 'Agendamento') end,
          case when appointment.staff_member_id is null then ''
            else ' com ' || coalesce(appointment.staff_member_name_snapshot, staff.name) end
        ),
        'service_id', appointment.service_id,
        'service_name', coalesce(appointment.service_name_snapshot, service.name),
        'staff_member_id', appointment.staff_member_id,
        'staff_member_name', coalesce(appointment.staff_member_name_snapshot, staff.name),
        'bookable_resource_id', appointment.bookable_resource_id,
        'bookable_resource_name', coalesce(appointment.bookable_resource_name_snapshot, resource.name),
        'duration_minutes', coalesce(service.duration_minutes, resource.duration_minutes),
        'customer_birth_date', coalesce(customer.birth_date, external_customer.birth_date)
      ) order by appointment.starts_at)
      from public.appointments appointment
      left join public.tenant_customers customer on customer.id = appointment.tenant_customer_id
      left join public.end_customers external_customer on external_customer.id = appointment.end_customer_id
      left join public.tenant_services service on service.id = appointment.service_id
      left join public.tenant_staff_members staff on staff.id = appointment.staff_member_id
      left join public.tenant_bookable_resources resource on resource.id = appointment.bookable_resource_id
      where appointment.tenant_id = base.tenant_id
        and appointment.deleted_at is null
        and appointment.status in ('scheduled', 'confirmed')
        and appointment.starts_at >= now()
        and regexp_replace(coalesce(customer.phone_e164, external_customer.whatsapp_e164, ''), '\D', '', 'g') =
            regexp_replace(coalesce(p_chat_id, ''), '\D', '', 'g')
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', resource.id,
        'name', resource.name,
        'kind', resource.kind,
        'description', resource.description,
        'duration_minutes', resource.duration_minutes,
        'price_cents', resource.price_cents
      ) order by resource.name)
      from public.tenant_bookable_resources resource
      join public.tenants tenant on tenant.id = resource.tenant_id
      where resource.tenant_id = base.tenant_id
        and resource.is_active = true
        and tenant.plan = 'plan3'
        and tenant.resource_booking_plus_enabled = true
    ), '[]'::jsonb)
  from public.wa_appointment_load_or_create_context(
    p_tenant_id, p_tenant_phone_e164, p_chat_id, p_init_payload
  ) base;
$$;

create or replace function public.recalculate_tenant_staff_surcharge(p_tenant_id uuid)
returns table (
  base_amount_cents integer,
  additional_staff_count integer,
  additional_staff_amount_cents integer,
  total_amount_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base integer;
  v_plan text;
  v_business_type text;
  v_resource_plus boolean := false;
  v_extra_count integer := 0;
  v_unit_amount integer := 0;
  v_extra_amount integer := 0;
  v_resource_amount integer := 0;
  v_pending_removal_amount integer := 0;
  v_total integer;
begin
  select plan.monthly_amount_cents, tenant.plan, tenant.business_type,
         tenant.resource_booking_plus_enabled
  into v_base, v_plan, v_business_type, v_resource_plus
  from public.tenants tenant
  join public.platform_plans plan on plan.code = tenant.plan
  where tenant.id = p_tenant_id;

  if v_base is null then raise exception 'tenant_plan_not_found'; end if;

  select greatest(count(staff.id)::integer - 1, 0)
  into v_extra_count
  from public.tenant_staff_members staff
  where staff.tenant_id = p_tenant_id and staff.is_active = true;

  if v_plan = 'plan3' then
    v_unit_amount := 5000;
  elsif v_plan = 'plan2' and v_business_type = 'salon' then
    v_unit_amount := 2500;
  else
    v_extra_count := 0;
  end if;

  select coalesce(max(profile.pending_staff_removal_charge_cents), 0)
  into v_pending_removal_amount
  from public.platform_tenant_billing_profiles profile
  where profile.tenant_id = p_tenant_id and profile.status in ('active', 'paused');

  v_extra_count := coalesce(v_extra_count, 0);
  v_extra_amount := v_extra_count * v_unit_amount;
  v_resource_amount := case when v_plan = 'plan3' and v_resource_plus then 7990 else 0 end;
  v_total := v_base + v_extra_amount + v_resource_amount + v_pending_removal_amount;

  update public.platform_tenant_billing_profiles profile
  set base_amount_cents = v_base,
      additional_staff_count = v_extra_count,
      additional_staff_amount_cents = v_extra_amount,
      resource_booking_plus_amount_cents = v_resource_amount,
      amount_cents = v_total,
      updated_at = now()
  where profile.tenant_id = p_tenant_id and profile.status in ('active', 'paused');

  return query select v_base, v_extra_count, v_extra_amount, v_total;
end;
$$;

revoke all on function public.admin_create_external_resource_appointment(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text, text
) from public, anon;
grant execute on function public.admin_create_external_resource_appointment(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text, text
) to authenticated, service_role;

revoke all on function public.wa_appointment_create_resource_external(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.wa_appointment_create_resource_external(
  uuid, text, text, text, date, uuid, timestamptz, timestamptz, text, text
) to service_role;

revoke all on function public.wa_appointment_suggest_resource_slots(
  uuid, uuid, date, text, integer, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.wa_appointment_suggest_resource_slots(
  uuid, uuid, date, text, integer, integer, integer, text
) to service_role;

revoke all on function public.wa_appointment_load_or_create_context_v2(
  uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.wa_appointment_load_or_create_context_v2(
  uuid, text, text, jsonb
) to service_role;

revoke all on function public.prevent_bookable_resource_overlap()
from public, anon, authenticated;

do $$
declare v_tenant_id uuid;
begin
  for v_tenant_id in select tenant.id from public.tenants tenant loop
    perform public.recalculate_tenant_staff_surcharge(v_tenant_id);
  end loop;
end;
$$;

update public.platform_plans
set name = 'Plano 3 - Completo',
    description = 'Cobranças, alunos e agenda para academias, arenas e negócios de serviços. Inclui 1 profissional; cada adicional custa R$ 50,00/mês. O Plus Quadras e ambientes custa R$ 79,90/mês.',
    updated_at = now()
where code = 'plan3';
