-- Fixes the plan alias used while recalculating salon staff surcharges.
-- Migration 049 renamed the platform_plans alias to `plan`, but the SELECT
-- still referenced `pp`, causing every staff insert/update/delete to fail.

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
  select plan.monthly_amount_cents
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

revoke all on function public.recalculate_tenant_staff_surcharge(uuid)
from public, anon, authenticated;
grant execute on function public.recalculate_tenant_staff_surcharge(uuid)
to service_role;

do $$
declare
  v_tenant_id uuid;
begin
  for v_tenant_id in select tenant.id from public.tenants tenant loop
    perform public.recalculate_tenant_staff_surcharge(v_tenant_id);
  end loop;
end;
$$;
