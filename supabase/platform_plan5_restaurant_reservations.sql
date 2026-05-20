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
values (
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

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'subscriptions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.subscriptions drop constraint if exists %I', v_constraint_name);
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('plan1', 'plan2', 'plan3', 'plan4', 'plan5'));

insert into public.tenant_menu_groups (tenant_id, name, sort_order, is_active)
select t.id, defaults.name, defaults.sort_order, true
from public.tenants t
cross join (
  values
    ('Bebidas', 10),
    ('Aperitivos', 20),
    ('Pratos principais', 30)
) as defaults(name, sort_order)
where t.plan in ('plan4', 'plan5')
  and not exists (
    select 1
    from public.tenant_menu_groups g
    where g.tenant_id = t.id
      and lower(g.name) = lower(defaults.name)
  );

create or replace function public.wa_restaurant_menu_grouped(
  p_tenant_id uuid
)
returns table (
  grouped_menu jsonb,
  whatsapp_text text
)
language sql
security definer
set search_path = public
as $$
  with active_items as (
    select
      coalesce(g.id, '00000000-0000-0000-0000-000000000000'::uuid) as group_id,
      coalesce(g.name, 'Outros') as group_name,
      coalesce(g.sort_order, 9999) as group_sort_order,
      i.id,
      i.name,
      i.description,
      i.price_cents
    from public.tenant_menu_items i
    left join public.tenant_menu_groups g
      on g.id = i.group_id
     and g.tenant_id = i.tenant_id
     and g.is_active = true
    join public.tenants t on t.id = i.tenant_id
    where i.tenant_id = p_tenant_id
      and i.is_active = true
      and t.status = 'active'
      and t.plan in ('plan4', 'plan5')
  ),
  groups as (
    select
      group_id,
      group_name,
      group_sort_order,
      jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'description', description,
          'price_cents', price_cents
        )
        order by name
      ) as items,
      concat(
        '*', group_name, '*',
        E'\n',
        string_agg(
          concat(
            '- ', name,
            ' - R$ ',
            replace(to_char(coalesce(price_cents, 0) / 100.0, 'FM999999990D00'), '.', ','),
            case
              when nullif(trim(coalesce(description, '')), '') is null then ''
              else concat(E'\n  ', description)
            end
          ),
          E'\n'
          order by name
        )
      ) as group_text
    from active_items
    group by group_id, group_name, group_sort_order
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', group_id,
          'name', group_name,
          'items', items
        )
        order by group_sort_order, group_name
      ),
      '[]'::jsonb
    ) as grouped_menu,
    coalesce(
      string_agg(group_text, E'\n\n' order by group_sort_order, group_name),
      'Cardapio ainda nao configurado.'
    ) as whatsapp_text
  from groups;
$$;

grant execute on function public.wa_restaurant_menu_grouped(uuid) to authenticated, service_role;
