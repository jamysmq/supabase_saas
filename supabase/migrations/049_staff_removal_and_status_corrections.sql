-- Makes existing appointments manageable after working-day changes and adds
-- audited staff removal with a one-time next-billing charge after 15 days.

alter table public.platform_tenant_billing_profiles
add column if not exists pending_staff_removal_charge_count integer not null default 0;

alter table public.platform_tenant_billing_profiles
add column if not exists pending_staff_removal_charge_cents integer not null default 0;

alter table public.platform_tenant_billing_profiles
drop constraint if exists platform_tenant_billing_profiles_pending_staff_removal_check;

alter table public.platform_tenant_billing_profiles
add constraint platform_tenant_billing_profiles_pending_staff_removal_check
check (
  pending_staff_removal_charge_count >= 0
  and pending_staff_removal_charge_cents >= 0
  and pending_staff_removal_charge_cents =
      pending_staff_removal_charge_count * 2500
);

create table if not exists public.tenant_staff_removal_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  requested_by_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  staff_member_name_snapshot text not null,
  staff_member_role_snapshot text,
  active_from timestamptz not null,
  removed_at timestamptz not null default now(),
  active_days integer not null check (active_days >= 0),
  charge_next_billing boolean not null default false,
  amount_cents integer not null default 0 check (amount_cents in (0, 2500)),
  consumed_payment_id uuid references public.payments(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_staff_removal_events_charge_check check (
    (charge_next_billing = true and amount_cents = 2500)
    or (charge_next_billing = false and amount_cents = 0)
  )
);

create index if not exists tenant_staff_removal_events_tenant_removed_idx
on public.tenant_staff_removal_events(tenant_id, removed_at desc);

create index if not exists tenant_staff_removal_events_pending_charge_idx
on public.tenant_staff_removal_events(tenant_id, consumed_at)
where charge_next_billing = true and consumed_at is null;

alter table public.tenant_staff_removal_events enable row level security;
grant select, insert, update, delete on public.tenant_staff_removal_events to service_role;

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
  v_extra_count integer := 0;
  v_extra_amount integer := 0;
  v_pending_removal_amount integer := 0;
  v_total integer;
begin
  select pp.monthly_amount_cents
  into v_base
  from public.tenants tenant
  join public.platform_plans plan on plan.code = tenant.plan
  where tenant.id = p_tenant_id;

  if v_base is null then raise exception 'tenant_plan_not_found'; end if;

  select case
    when tenant.business_type = 'salon' and tenant.plan in ('plan2', 'plan3')
      then greatest(count(staff.id)::integer - 1, 0)
    else 0
  end
  into v_extra_count
  from public.tenants tenant
  left join public.tenant_staff_members staff
    on staff.tenant_id = tenant.id and staff.is_active = true
  where tenant.id = p_tenant_id
  group by tenant.business_type, tenant.plan;

  select coalesce(max(profile.pending_staff_removal_charge_cents), 0)
  into v_pending_removal_amount
  from public.platform_tenant_billing_profiles profile
  where profile.tenant_id = p_tenant_id
    and profile.status in ('active', 'paused');

  v_extra_count := coalesce(v_extra_count, 0);
  v_extra_amount := v_extra_count * 2500;
  v_total := v_base + v_extra_amount + v_pending_removal_amount;

  update public.platform_tenant_billing_profiles profile
  set base_amount_cents = v_base,
      additional_staff_count = v_extra_count,
      additional_staff_amount_cents = v_extra_amount,
      amount_cents = v_total,
      updated_at = now()
  where profile.tenant_id = p_tenant_id
    and profile.status in ('active', 'paused');

  return query select v_base, v_extra_count, v_extra_amount, v_total;
end;
$$;

create or replace function public.enforce_appointment_service_staff_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.service_id is not distinct from old.service_id
     and new.staff_member_id is not distinct from old.staff_member_id then
    return new;
  end if;

  -- ON DELETE SET NULL preserves historical appointments. New appointments
  -- and manual reassignment still require an active linked professional.
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
      or (old.deleted_at is not null and new.deleted_at is null);
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
before insert or update of tenant_id, starts_at, deleted_at
on public.appointments
for each row execute function public.prevent_appointment_outside_working_days();

create or replace function public.admin_update_appointment_outcome(
  p_tenant_id uuid,
  p_appointment_id uuid,
  p_tenant_user_id uuid,
  p_status text,
  p_source text default 'panel'
)
returns table (
  appointment_id uuid,
  appointment_status text,
  status_event_id uuid,
  revenue_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment public.appointments%rowtype;
  v_status_event_id uuid;
  v_revenue_event_id uuid;
begin
  if p_status not in ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid_appointment_status';
  end if;

  if not exists (
    select 1 from public.tenant_users tenant_user
    where tenant_user.id = p_tenant_user_id
      and tenant_user.tenant_id = p_tenant_id
  ) then raise exception 'tenant_user_not_allowed'; end if;

  select appointment.* into v_appointment
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and appointment.tenant_id = p_tenant_id
    and appointment.deleted_at is null
  for update;

  if v_appointment.id is null then raise exception 'appointment_not_found'; end if;

  if p_status in ('completed', 'no_show') and v_appointment.ends_at > now() then
    raise exception 'appointment_has_not_ended';
  end if;

  if v_appointment.status is distinct from p_status then
    update public.appointments
    set status = p_status,
        cancelled_at = case when p_status = 'cancelled' then now() else null end,
        updated_at = now()
    where id = v_appointment.id;

    insert into public.appointment_status_events (
      appointment_id, tenant_id, tenant_user_id, old_status, new_status, source
    ) values (
      v_appointment.id, p_tenant_id, p_tenant_user_id, v_appointment.status,
      p_status, coalesce(nullif(trim(p_source), ''), 'panel')
    ) returning id into v_status_event_id;

    v_revenue_event_id := public.admin_sync_appointment_service_revenue(
      v_appointment.id,
      coalesce(nullif(trim(p_source), ''), 'panel')
    );
  end if;

  appointment_id := v_appointment.id;
  appointment_status := p_status;
  status_event_id := v_status_event_id;
  revenue_event_id := v_revenue_event_id;
  return next;
end;
$$;

create or replace function public.admin_remove_tenant_staff_member(
  p_tenant_id uuid,
  p_staff_member_id uuid,
  p_tenant_user_id uuid
)
returns table (
  staff_member_id uuid,
  active_days integer,
  charge_next_billing boolean,
  charge_amount_cents integer,
  total_amount_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff public.tenant_staff_members%rowtype;
  v_active_from timestamptz;
  v_active_days integer;
  v_active_count integer;
  v_charge boolean := false;
  v_charge_amount integer := 0;
  v_total integer;
begin
  if not exists (
    select 1 from public.tenant_users tenant_user
    where tenant_user.id = p_tenant_user_id
      and tenant_user.tenant_id = p_tenant_id
  ) then raise exception 'tenant_user_not_allowed'; end if;

  select staff.* into v_staff
  from public.tenant_staff_members staff
  where staff.id = p_staff_member_id
    and staff.tenant_id = p_tenant_id
    and staff.is_active = true
  for update;

  if v_staff.id is null then raise exception 'staff_member_not_found'; end if;

  if exists (
    select 1 from public.appointments appointment
    where appointment.tenant_id = p_tenant_id
      and appointment.staff_member_id = v_staff.id
      and appointment.deleted_at is null
      and appointment.status in ('scheduled', 'confirmed')
      and appointment.ends_at > now()
  ) then raise exception 'staff_has_future_appointments'; end if;

  select coalesce(max(request.reviewed_at), v_staff.created_at)
  into v_active_from
  from public.tenant_staff_addition_requests request
  where request.approved_staff_member_id = v_staff.id
    and request.status = 'approved';

  v_active_from := coalesce(v_active_from, v_staff.created_at);
  v_active_days := greatest(current_date - (v_active_from at time zone 'America/Fortaleza')::date, 0);

  select count(*)::integer into v_active_count
  from public.tenant_staff_members staff
  where staff.tenant_id = p_tenant_id and staff.is_active = true;

  select (
    tenant.business_type = 'salon'
    and tenant.plan in ('plan2', 'plan3')
    and v_active_count > 1
    and v_active_days > 15
  ) into v_charge
  from public.tenants tenant
  where tenant.id = p_tenant_id;

  v_charge := coalesce(v_charge, false);
  v_charge_amount := case when v_charge then 2500 else 0 end;

  if v_charge then
    update public.platform_tenant_billing_profiles profile
    set pending_staff_removal_charge_count = pending_staff_removal_charge_count + 1,
        pending_staff_removal_charge_cents = pending_staff_removal_charge_cents + 2500,
        updated_at = now()
    where profile.tenant_id = p_tenant_id
      and profile.status in ('active', 'paused');
  end if;

  insert into public.tenant_staff_removal_events (
    tenant_id, staff_member_id, requested_by_tenant_user_id,
    staff_member_name_snapshot, staff_member_role_snapshot,
    active_from, active_days, charge_next_billing, amount_cents
  ) values (
    p_tenant_id, v_staff.id, p_tenant_user_id,
    v_staff.name, v_staff.role, v_active_from,
    v_active_days, v_charge, v_charge_amount
  );

  -- Older appointments may predate the snapshot columns. Fill the professional
  -- name before ON DELETE SET NULL detaches the historical foreign key.
  update public.appointments appointment
  set staff_member_name_snapshot = coalesce(
        nullif(trim(appointment.staff_member_name_snapshot), ''),
        v_staff.name
      ),
      updated_at = now()
  where appointment.tenant_id = p_tenant_id
    and appointment.staff_member_id = v_staff.id;

  delete from public.tenant_staff_members where id = v_staff.id;

  select recalculated.total_amount_cents into v_total
  from public.recalculate_tenant_staff_surcharge(p_tenant_id) recalculated;

  staff_member_id := p_staff_member_id;
  active_days := v_active_days;
  charge_next_billing := v_charge;
  charge_amount_cents := v_charge_amount;
  total_amount_cents := v_total;
  return next;
end;
$$;

create or replace function public.apply_pending_staff_removal_charge_to_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.platform_tenant_billing_profiles%rowtype;
begin
  if new.tenant_id is null
     or new.billing_type is distinct from 'platform_subscription' then
    return new;
  end if;

  select profile.* into v_profile
  from public.platform_tenant_billing_profiles profile
  where profile.tenant_id = new.tenant_id
    and profile.status in ('active', 'paused')
  order by profile.created_at desc
  limit 1;

  if v_profile.id is null then return new; end if;

  new.amount_cents := v_profile.amount_cents;
  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'billing_profile_id', v_profile.id,
    'pending_staff_removal_charge_count', v_profile.pending_staff_removal_charge_count,
    'pending_staff_removal_charge_cents', v_profile.pending_staff_removal_charge_cents
  );
  return new;
end;
$$;

create or replace function public.consume_pending_staff_removal_charge_after_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending_count integer := coalesce((new.payload ->> 'pending_staff_removal_charge_count')::integer, 0);
begin
  if new.tenant_id is null
     or new.billing_type is distinct from 'platform_subscription'
     or v_pending_count <= 0 then
    return new;
  end if;

  update public.tenant_staff_removal_events
  set consumed_payment_id = new.id, consumed_at = now()
  where tenant_id = new.tenant_id
    and charge_next_billing = true
    and consumed_at is null;

  update public.platform_tenant_billing_profiles
  set pending_staff_removal_charge_count = 0,
      pending_staff_removal_charge_cents = 0,
      updated_at = now()
  where tenant_id = new.tenant_id
    and status in ('active', 'paused');

  perform public.recalculate_tenant_staff_surcharge(new.tenant_id);
  return new;
end;
$$;

drop trigger if exists payments_apply_pending_staff_removal_charge on public.payments;
create trigger payments_apply_pending_staff_removal_charge
before insert on public.payments
for each row execute function public.apply_pending_staff_removal_charge_to_payment();

drop trigger if exists payments_consume_pending_staff_removal_charge on public.payments;
create trigger payments_consume_pending_staff_removal_charge
after insert on public.payments
for each row execute function public.consume_pending_staff_removal_charge_after_payment();

revoke all on function public.admin_remove_tenant_staff_member(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_remove_tenant_staff_member(uuid, uuid, uuid)
to service_role;

revoke all on function public.apply_pending_staff_removal_charge_to_payment()
from public, anon, authenticated;
revoke all on function public.consume_pending_staff_removal_charge_after_payment()
from public, anon, authenticated;
revoke all on function public.enforce_appointment_service_staff_link()
from public, anon, authenticated;
revoke all on function public.prevent_appointment_outside_working_days()
from public, anon, authenticated;
