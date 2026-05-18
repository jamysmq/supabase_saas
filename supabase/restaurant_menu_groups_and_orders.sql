create table if not exists public.tenant_menu_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_menu_groups
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists name text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.tenant_menu_items
  add column if not exists group_id uuid references public.tenant_menu_groups(id) on delete set null;

create index if not exists tenant_menu_groups_tenant_active_idx
on public.tenant_menu_groups (tenant_id, is_active, sort_order, name);

create index if not exists tenant_menu_items_group_idx
on public.tenant_menu_items (group_id);

alter table public.tenant_menu_groups enable row level security;

grant select
on public.tenant_menu_groups
to authenticated;

grant select, insert, update, delete
on public.tenant_menu_groups
to service_role;

drop policy if exists "tenant_menu_groups_read_own_tenant" on public.tenant_menu_groups;
create policy "tenant_menu_groups_read_own_tenant"
on public.tenant_menu_groups
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_menu_groups.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

insert into public.tenant_menu_groups (tenant_id, name, sort_order, is_active)
select t.id, defaults.name, defaults.sort_order, true
from public.tenants t
cross join (
  values
    ('Bebidas', 10),
    ('Aperitivos', 20),
    ('Pratos principais', 30)
) as defaults(name, sort_order)
where t.plan = 'plan4'
  and not exists (
    select 1
    from public.tenant_menu_groups g
    where g.tenant_id = t.id
      and lower(g.name) = lower(defaults.name)
  );

create table if not exists public.tenant_restaurant_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_name text,
  customer_phone_e164 text,
  delivery_address text,
  notes text,
  subtotal_cents integer not null default 0,
  delivery_fee_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'BRL',
  payment_method text not null default 'cash_on_delivery',
  status text not null default 'confirmed',
  source text not null default 'whatsapp',
  confirmed_at timestamptz not null default now(),
  paid_at timestamptz,
  cancelled_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_restaurant_orders
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists customer_name text,
  add column if not exists customer_phone_e164 text,
  add column if not exists delivery_address text,
  add column if not exists notes text,
  add column if not exists subtotal_cents integer not null default 0,
  add column if not exists delivery_fee_cents integer not null default 0,
  add column if not exists total_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists payment_method text not null default 'cash_on_delivery',
  add column if not exists status text not null default 'confirmed',
  add column if not exists source text not null default 'whatsapp',
  add column if not exists confirmed_at timestamptz not null default now(),
  add column if not exists paid_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.tenant_restaurant_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.tenant_restaurant_orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  menu_item_id uuid references public.tenant_menu_items(id) on delete set null,
  menu_group_name_snapshot text,
  item_name_snapshot text not null,
  item_description_snapshot text,
  unit_price_cents integer not null default 0,
  quantity integer not null default 1,
  total_cents integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.tenant_restaurant_order_items
  add column if not exists order_id uuid references public.tenant_restaurant_orders(id) on delete cascade,
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists menu_item_id uuid references public.tenant_menu_items(id) on delete set null,
  add column if not exists menu_group_name_snapshot text,
  add column if not exists item_name_snapshot text,
  add column if not exists item_description_snapshot text,
  add column if not exists unit_price_cents integer not null default 0,
  add column if not exists quantity integer not null default 1,
  add column if not exists total_cents integer not null default 0,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.tenant_restaurant_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.tenant_restaurant_orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_user_id uuid references public.tenant_users(id) on delete set null,
  old_status text,
  new_status text not null,
  source text not null default 'panel',
  note text,
  created_at timestamptz not null default now()
);

alter table public.tenant_restaurant_order_events
  add column if not exists order_id uuid references public.tenant_restaurant_orders(id) on delete cascade,
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists tenant_user_id uuid references public.tenant_users(id) on delete set null,
  add column if not exists old_status text,
  add column if not exists new_status text,
  add column if not exists source text not null default 'panel',
  add column if not exists note text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.tenant_restaurant_order_revenue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.tenant_restaurant_orders(id) on delete cascade,
  customer_name_snapshot text,
  customer_phone_snapshot text,
  total_cents integer not null default 0,
  currency text not null default 'BRL',
  payment_method text not null default 'cash_on_delivery',
  status text not null default 'recognized',
  source text not null default 'panel',
  recognized_at timestamptz not null default now(),
  voided_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_restaurant_order_revenue_events
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists order_id uuid references public.tenant_restaurant_orders(id) on delete cascade,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists total_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists payment_method text not null default 'cash_on_delivery',
  add column if not exists status text not null default 'recognized',
  add column if not exists source text not null default 'panel',
  add column if not exists recognized_at timestamptz not null default now(),
  add column if not exists voided_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tenant_restaurant_order_revenue_events_order_uidx
on public.tenant_restaurant_order_revenue_events (order_id);

create index if not exists tenant_restaurant_orders_tenant_status_idx
on public.tenant_restaurant_orders (tenant_id, status, confirmed_at desc);

create index if not exists tenant_restaurant_order_items_order_idx
on public.tenant_restaurant_order_items (order_id);

create index if not exists tenant_restaurant_order_events_tenant_idx
on public.tenant_restaurant_order_events (tenant_id, created_at desc);

create index if not exists tenant_restaurant_order_revenue_tenant_idx
on public.tenant_restaurant_order_revenue_events (tenant_id, recognized_at desc);

alter table public.tenant_restaurant_orders enable row level security;
alter table public.tenant_restaurant_order_items enable row level security;
alter table public.tenant_restaurant_order_events enable row level security;
alter table public.tenant_restaurant_order_revenue_events enable row level security;

grant select
on public.tenant_restaurant_orders, public.tenant_restaurant_order_items, public.tenant_restaurant_order_events, public.tenant_restaurant_order_revenue_events
to authenticated;

grant select, insert, update, delete
on public.tenant_restaurant_orders, public.tenant_restaurant_order_items, public.tenant_restaurant_order_events, public.tenant_restaurant_order_revenue_events
to service_role;

drop policy if exists "tenant_restaurant_orders_read_own_tenant" on public.tenant_restaurant_orders;
create policy "tenant_restaurant_orders_read_own_tenant"
on public.tenant_restaurant_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_restaurant_orders.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_restaurant_order_items_read_own_tenant" on public.tenant_restaurant_order_items;
create policy "tenant_restaurant_order_items_read_own_tenant"
on public.tenant_restaurant_order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_restaurant_order_items.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_restaurant_order_events_read_own_tenant" on public.tenant_restaurant_order_events;
create policy "tenant_restaurant_order_events_read_own_tenant"
on public.tenant_restaurant_order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_restaurant_order_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_restaurant_order_revenue_read_own_tenant" on public.tenant_restaurant_order_revenue_events;
create policy "tenant_restaurant_order_revenue_read_own_tenant"
on public.tenant_restaurant_order_revenue_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_restaurant_order_revenue_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
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
      and t.plan = 'plan4'
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
    coalesce(string_agg(group_text, E'\n\n' order by group_sort_order, group_name), '') as whatsapp_text
  from groups;
$$;

create or replace function public.admin_sync_restaurant_order_revenue(
  p_order_id uuid,
  p_source text default 'panel'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_event_id uuid;
begin
  select *
    into v_order
  from public.tenant_restaurant_orders o
  where o.id = p_order_id;

  if v_order.id is null then
    raise exception 'restaurant_order_not_found';
  end if;

  if v_order.status = 'paid' and v_order.total_cents > 0 then
    insert into public.tenant_restaurant_order_revenue_events (
      tenant_id,
      order_id,
      customer_name_snapshot,
      customer_phone_snapshot,
      total_cents,
      payment_method,
      status,
      source,
      recognized_at,
      voided_at,
      payload
    )
    values (
      v_order.tenant_id,
      v_order.id,
      v_order.customer_name,
      v_order.customer_phone_e164,
      v_order.total_cents,
      v_order.payment_method,
      'recognized',
      coalesce(nullif(trim(p_source), ''), 'panel'),
      coalesce(v_order.paid_at, now()),
      null,
      jsonb_build_object('order_status', v_order.status)
    )
    on conflict (order_id)
    do update set
      customer_name_snapshot = excluded.customer_name_snapshot,
      customer_phone_snapshot = excluded.customer_phone_snapshot,
      total_cents = excluded.total_cents,
      payment_method = excluded.payment_method,
      status = 'recognized',
      source = excluded.source,
      recognized_at = excluded.recognized_at,
      voided_at = null,
      payload = excluded.payload,
      updated_at = now()
    returning id into v_event_id;

    return v_event_id;
  end if;

  update public.tenant_restaurant_order_revenue_events
  set
    status = 'voided',
    voided_at = coalesce(voided_at, now()),
    source = coalesce(nullif(trim(p_source), ''), source),
    payload = jsonb_build_object('order_status', v_order.status),
    updated_at = now()
  where order_id = p_order_id
    and status = 'recognized'
  returning id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.wa_restaurant_menu_grouped(uuid) to authenticated, service_role;
grant execute on function public.admin_sync_restaurant_order_revenue(uuid, text) to authenticated, service_role;
