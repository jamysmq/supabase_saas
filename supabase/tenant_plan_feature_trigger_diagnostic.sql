-- Rode este bloco quando a criacao de tenant falhar com:
-- column reference "tenant_id" is ambiguous
--
-- Ele nao altera nada. Serve para identificar qual trigger/function do banco
-- esta disparando durante o insert em public.tenants.

select
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'tenants',
    'subscriptions',
    'tenant_billing_settings',
    'tenant_users',
    'platform_tenant_billing_profiles'
  )
order by event_object_table, trigger_name;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%tenant%plan%'
    or p.proname ilike '%plan%feature%'
    or p.proname ilike '%tenant%feature%'
    or p.proname ilike '%platform%tenant%'
  )
order by p.proname;
