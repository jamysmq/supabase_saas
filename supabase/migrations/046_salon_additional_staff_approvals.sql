-- Requires platform approval for additional salon professionals and keeps the
-- tenant monthly price equal to the plan base plus R$ 25 per extra professional.

alter table public.platform_tenant_billing_profiles
add column if not exists base_amount_cents integer;

alter table public.platform_tenant_billing_profiles
add column if not exists additional_staff_count integer not null default 0;

alter table public.platform_tenant_billing_profiles
add column if not exists additional_staff_amount_cents integer not null default 0;

alter table public.platform_tenant_billing_profiles
drop constraint if exists platform_tenant_billing_profiles_additional_staff_check;

alter table public.platform_tenant_billing_profiles
add constraint platform_tenant_billing_profiles_additional_staff_check
check (additional_staff_count >= 0 and additional_staff_amount_cents >= 0);

create table if not exists public.tenant_staff_addition_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_by_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  name text not null,
  role text,
  status text not null default 'pending',
  additional_amount_cents integer not null default 2500,
  reviewed_by_platform_admin_auth_user_id uuid references public.platform_admins(auth_user_id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  approved_staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_staff_addition_requests_name_check
    check (char_length(trim(name)) between 1 and 160),
  constraint tenant_staff_addition_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint tenant_staff_addition_requests_amount_check
    check (additional_amount_cents = 2500)
);

create index if not exists tenant_staff_addition_requests_tenant_status_idx
on public.tenant_staff_addition_requests(tenant_id, status, created_at desc);

create unique index if not exists tenant_staff_addition_requests_pending_name_uq
on public.tenant_staff_addition_requests(tenant_id, lower(trim(name)))
where status = 'pending';

alter table public.tenant_staff_addition_requests enable row level security;
grant select, insert, update, delete on public.tenant_staff_addition_requests to service_role;

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
  v_total integer;
begin
  select pp.monthly_amount_cents
  into v_base
  from public.tenants t
  join public.platform_plans pp on pp.code = t.plan
  where t.id = p_tenant_id;

  if v_base is null then raise exception 'tenant_plan_not_found'; end if;

  select case
    when t.business_type = 'salon' and t.plan in ('plan2', 'plan3')
      then greatest(count(sm.id)::integer - 1, 0)
    else 0
  end
  into v_extra_count
  from public.tenants t
  left join public.tenant_staff_members sm
    on sm.tenant_id = t.id and sm.is_active = true
  where t.id = p_tenant_id
  group by t.business_type, t.plan;

  v_extra_count := coalesce(v_extra_count, 0);
  v_extra_amount := v_extra_count * 2500;
  v_total := v_base + v_extra_amount;

  update public.platform_tenant_billing_profiles bp
  set base_amount_cents = v_base,
      additional_staff_count = v_extra_count,
      additional_staff_amount_cents = v_extra_amount,
      amount_cents = v_total,
      updated_at = now()
  where bp.tenant_id = p_tenant_id
    and bp.status in ('active', 'paused');

  return query select v_base, v_extra_count, v_extra_amount, v_total;
end;
$$;

create or replace function public.sync_tenant_staff_surcharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_tenant_staff_surcharge(
    case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end
  );
  if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id then
    perform public.recalculate_tenant_staff_surcharge(old.tenant_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_staff_members_sync_surcharge on public.tenant_staff_members;
create trigger tenant_staff_members_sync_surcharge
after insert or delete or update of tenant_id, is_active on public.tenant_staff_members
for each row execute function public.sync_tenant_staff_surcharge();

create or replace function public.sync_tenant_plan_staff_surcharge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_tenant_staff_surcharge(new.id);
  return new;
end;
$$;

drop trigger if exists tenants_sync_staff_surcharge on public.tenants;
create trigger tenants_sync_staff_surcharge
after update of plan, business_type on public.tenants
for each row execute function public.sync_tenant_plan_staff_surcharge();

create or replace function public.sync_platform_plan_price_to_tenants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  if new.monthly_amount_cents is distinct from old.monthly_amount_cents then
    for v_tenant_id in select t.id from public.tenants t where t.plan = new.code loop
      perform public.recalculate_tenant_staff_surcharge(v_tenant_id);
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.platform_review_tenant_staff_addition(
  p_request_id uuid,
  p_platform_admin_auth_user_id uuid,
  p_decision text,
  p_review_notes text default null
)
returns table (
  request_id uuid,
  request_status text,
  staff_member_id uuid,
  total_amount_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tenant_staff_addition_requests%rowtype;
  v_staff_member_id uuid;
  v_total integer;
begin
  if not exists (
    select 1 from public.platform_admins pa
    where pa.auth_user_id = p_platform_admin_auth_user_id and pa.is_active = true
  ) then raise exception 'platform_admin_not_allowed'; end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_staff_request_decision';
  end if;

  select * into v_request
  from public.tenant_staff_addition_requests r
  where r.id = p_request_id
  for update;

  if v_request.id is null then raise exception 'staff_addition_request_not_found'; end if;
  if v_request.status <> 'pending' then
    raise exception 'staff_addition_request_already_reviewed';
  end if;

  if p_decision = 'approved' then
    if not exists (
      select 1 from public.tenants t
      where t.id = v_request.tenant_id
        and t.status = 'active'
        and t.business_type = 'salon'
        and t.plan in ('plan2', 'plan3')
    ) then
      raise exception 'tenant_no_longer_eligible_for_additional_staff';
    end if;

    insert into public.tenant_staff_members (tenant_id, name, role, is_active)
    values (v_request.tenant_id, trim(v_request.name), v_request.role, true)
    returning id into v_staff_member_id;
  end if;

  update public.tenant_staff_addition_requests
  set status = p_decision,
      reviewed_by_platform_admin_auth_user_id = p_platform_admin_auth_user_id,
      reviewed_at = now(),
      review_notes = nullif(trim(coalesce(p_review_notes, '')), ''),
      approved_staff_member_id = v_staff_member_id,
      updated_at = now()
  where id = v_request.id;

  select recalculated.total_amount_cents into v_total
  from public.recalculate_tenant_staff_surcharge(v_request.tenant_id) recalculated;

  request_id := v_request.id;
  request_status := p_decision;
  staff_member_id := v_staff_member_id;
  total_amount_cents := v_total;
  return next;
end;
$$;

revoke all on function public.recalculate_tenant_staff_surcharge(uuid)
from public, anon, authenticated;
grant execute on function public.recalculate_tenant_staff_surcharge(uuid) to service_role;
revoke all on function public.platform_review_tenant_staff_addition(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.platform_review_tenant_staff_addition(uuid, uuid, text, text)
to service_role;
revoke all on function public.sync_tenant_staff_surcharge()
from public, anon, authenticated;
revoke all on function public.sync_tenant_plan_staff_surcharge()
from public, anon, authenticated;

update public.platform_plans
set description = 'Agendamentos, remarcações e cancelamentos pelo WhatsApp, com agenda organizada no painel. R$ 49,90/mês para salões com 1 profissional; cada profissional adicional acrescenta R$ 25,00/mês após aprovação da Soft Ink.',
    updated_at = now()
where code = 'plan2';

update public.platform_plans
set description = 'Cobranças, clientes e agenda reunidos em uma única operação, no WhatsApp e no painel. R$ 79,90/mês; para salões, inclui 1 profissional e cada profissional adicional acrescenta R$ 25,00/mês após aprovação da Soft Ink.',
    updated_at = now()
where code = 'plan3';

update public.platform_tenant_billing_profiles bp
set base_amount_cents = pp.monthly_amount_cents,
    updated_at = now()
from public.tenants t
join public.platform_plans pp on pp.code = t.plan
where bp.tenant_id = t.id;

do $$
declare v_tenant_id uuid;
begin
  for v_tenant_id in select id from public.tenants loop
    perform public.recalculate_tenant_staff_surcharge(v_tenant_id);
  end loop;
end;
$$;
