-- Makes the platform plan catalog the source of truth for tenant monthly prices.
-- Changing a plan price overrides every individual tenant price linked to it.

create or replace function public.sync_platform_plan_price_to_tenants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.monthly_amount_cents is distinct from old.monthly_amount_cents then
    update public.platform_tenant_billing_profiles bp
    set amount_cents = new.monthly_amount_cents,
        updated_at = now()
    from public.tenants t
    where t.id = bp.tenant_id
      and t.plan = new.code;
  end if;

  return new;
end;
$$;

drop trigger if exists platform_plan_price_sync_tenants
on public.platform_plans;

create trigger platform_plan_price_sync_tenants
after update of monthly_amount_cents on public.platform_plans
for each row
execute function public.sync_platform_plan_price_to_tenants();

revoke all on function public.sync_platform_plan_price_to_tenants()
from public, anon, authenticated;

update public.platform_plans
set description = 'Cobranças e lembretes pelo WhatsApp, com controle de clientes, alunos e mensalidades. R$ 49,90/mês.',
    updated_at = now()
where code = 'plan1';

update public.platform_plans
set description = 'Agendamentos, remarcações e cancelamentos pelo WhatsApp, com agenda organizada no painel. R$ 49,90/mês.',
    updated_at = now()
where code = 'plan2';

update public.platform_plans
set description = 'Cobranças, clientes e agenda reunidos em uma única operação, no WhatsApp e no painel. R$ 79,90/mês.',
    updated_at = now()
where code = 'plan3';

update public.platform_plans
set description = 'Catálogo ou cardápio, produtos ou itens, pedidos pelo WhatsApp, controle de estoque e acompanhamento financeiro para lojas, restaurantes, pet shops e outros negócios. R$ 99,90/mês.',
    updated_at = now()
where code = 'plan4';

update public.platform_plans
set description = 'Tudo do Plano 4 — catálogo, pedidos, estoque e financeiro — com agenda de reservas para negócios que trabalham com horários, mesas ou atendimentos. R$ 179,90/mês.',
    updated_at = now()
where code = 'plan5';

-- Apply the table price even when a tenant had an individual override.
update public.platform_tenant_billing_profiles bp
set amount_cents = pp.monthly_amount_cents,
    updated_at = now()
from public.tenants t
join public.platform_plans pp on pp.code = t.plan
where bp.tenant_id = t.id;
