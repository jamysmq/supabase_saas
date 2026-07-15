-- Clarifies that catalog plans include inventory control.
update public.platform_plans
set description = 'Catálogo ou cardápio, produtos ou itens, pedidos pelo WhatsApp, controle de estoque e acompanhamento financeiro para lojas, restaurantes, pet shops e outros negócios. R$ 79,90/mês.', updated_at = now()
where code = 'plan4';
update public.platform_plans
set description = 'Tudo do Plano 4 — catálogo, pedidos, estoque e financeiro — com agenda de reservas para negócios que trabalham com horários, mesas ou atendimentos. R$ 139,90/mês.', updated_at = now()
where code = 'plan5';
