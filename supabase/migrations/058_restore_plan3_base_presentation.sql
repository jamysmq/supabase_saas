-- Keep Plan 3 presented as the base billing + appointments product.
-- Resource booking remains an admin-enabled Plus and is not advertised as included.

update public.platform_plans
set name = 'Plano 3 - Cobranças + agenda',
    description = 'Cobranças, alunos e agenda reunidos em uma única operação, no WhatsApp e no painel. R$ 79,90/mês.',
    updated_at = now()
where code = 'plan3';
