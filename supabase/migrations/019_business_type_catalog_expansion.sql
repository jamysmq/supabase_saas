-- Migration 019: expande tenants.business_type para o motor de catálogo + pedidos.
-- Inclui loja_material e petshop, que reutilizam o mesmo motor de pedidos do restaurante.
-- Aditivo e idempotente.

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
