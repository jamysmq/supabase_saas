-- Amplia o CHECK de tenants.business_type para incluir os novos tipos do motor
-- de catálogo + pedidos (ex-"restaurante"): loja de material de construção e petshop.
-- Aditivo e idempotente: apenas recria o constraint com a lista expandida.
-- Nao renomeia tabelas, colunas ou RPCs; o motor de pedidos continua nas tabelas atuais.

alter table public.tenants
drop constraint if exists tenants_business_type_check;

alter table public.tenants
add constraint tenants_business_type_check
check (
  business_type in (
    'teacher',
    'autonomous',
    'clinic',
    'salon',
    'restaurant',
    'loja_material',
    'petshop'
  )
);
