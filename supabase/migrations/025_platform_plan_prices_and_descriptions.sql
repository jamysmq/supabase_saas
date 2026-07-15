-- Synchronizes the official plan catalog and initializes existing tenants
-- with the current table price. Individual editing remains available later.

update public.platform_plans set name = 'Plano 1 - Cobrancas', description = 'Cobrancas e lembretes pelo WhatsApp, com controle de clientes, alunos e mensalidades. R$ 39,90/mes.', monthly_amount_cents = 3990, updated_at = now() where code = 'plan1';
update public.platform_plans set name = 'Plano 2 - Agenda', description = 'Agendamentos, remarcacoes e cancelamentos pelo WhatsApp, com agenda organizada no painel. R$ 39,90/mes.', monthly_amount_cents = 3990, updated_at = now() where code = 'plan2';
update public.platform_plans set name = 'Plano 3 - Completo', description = 'Cobrancas, clientes e agenda reunidos em uma unica operacao, no WhatsApp e no painel. R$ 69,90/mes.', monthly_amount_cents = 6990, updated_at = now() where code = 'plan3';
update public.platform_plans set name = 'Plano 4 - Catalogo e pedidos', description = 'Catalogo ou cardapio, produtos ou itens, pedidos pelo WhatsApp e controle financeiro para lojas, restaurantes, pet shops e outros negocios. R$ 79,90/mes.', monthly_amount_cents = 7990, updated_at = now() where code = 'plan4';
update public.platform_plans set name = 'Plano 5 - Catalogo, pedidos e reservas', description = 'Tudo do Plano 4, com a estrutura de agenda de reservas para negocios que trabalham com horarios, mesas ou atendimentos. R$ 139,90/mes.', monthly_amount_cents = 13990, updated_at = now() where code = 'plan5';

update public.platform_tenant_billing_profiles bp
set amount_cents = pp.monthly_amount_cents, updated_at = now()
from public.tenants t
join public.platform_plans pp on pp.code = t.plan
where bp.tenant_id = t.id and t.status = 'active';
