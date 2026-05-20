insert into public.platform_plans (
  code,
  name,
  description,
  monthly_amount_cents,
  currency,
  billing_interval,
  max_customer_groups,
  is_active,
  sort_order,
  updated_at
)
values
  (
    'plan1',
    'Plano 1 - Cobrancas',
    'Cobrancas mensais via WhatsApp e controle de alunos/clientes no site.',
    0,
    'BRL',
    'monthly',
    20,
    true,
    10,
    now()
  ),
  (
    'plan2',
    'Plano 2 - Agenda',
    'Agendamento via WhatsApp e controle de agendamentos no site.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    20,
    now()
  ),
  (
    'plan3',
    'Plano 3 - Completo',
    'Soma do Plano 1 e Plano 2: cobrancas, alunos/clientes e agenda.',
    0,
    'BRL',
    'monthly',
    20,
    true,
    30,
    now()
  ),
  (
    'plan4',
    'Plano 4 - Restaurantes',
    'Restaurante com cardapio, pedidos, financeiro e workflow WhatsApp proprio.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    40,
    now()
  ),
  (
    'plan5',
    'Plano 5 - Restaurantes + reservas',
    'Tudo do Plano 4, com agenda de mesas/reservas como feature planejada para restaurante.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    50,
    now()
  )
on conflict (code)
do update set
  name = excluded.name,
  description = excluded.description,
  currency = excluded.currency,
  billing_interval = excluded.billing_interval,
  max_customer_groups = excluded.max_customer_groups,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();
