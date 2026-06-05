alter table public.tenant_service_revenue_events
  alter column appointment_id drop not null;

create table if not exists public.tenant_salon_inventory_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  sku text,
  current_quantity numeric(12, 3) not null default 0,
  unit_cost_cents integer not null default 0,
  total_cost_cents integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_salon_inventory_products_name_uidx
on public.tenant_salon_inventory_products (tenant_id, lower(name));

create index if not exists tenant_salon_inventory_products_tenant_idx
on public.tenant_salon_inventory_products (tenant_id, is_active, name);

create table if not exists public.tenant_salon_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.tenant_salon_inventory_products(id) on delete cascade,
  movement_type text not null check (movement_type in ('purchase', 'adjustment', 'usage')),
  quantity_delta numeric(12, 3) not null,
  unit_cost_cents integer not null default 0,
  total_cost_cents integer not null default 0,
  supplier text,
  notes text,
  service_revenue_event_id uuid references public.tenant_service_revenue_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tenant_salon_inventory_movements_tenant_idx
on public.tenant_salon_inventory_movements (tenant_id, created_at desc);

alter table public.tenant_salon_inventory_products enable row level security;
alter table public.tenant_salon_inventory_movements enable row level security;

grant select on public.tenant_salon_inventory_products, public.tenant_salon_inventory_movements to authenticated;
grant select, insert, update, delete on public.tenant_salon_inventory_products, public.tenant_salon_inventory_movements to service_role;

drop policy if exists "tenant_salon_inventory_products_read_own_tenant"
on public.tenant_salon_inventory_products;

create policy "tenant_salon_inventory_products_read_own_tenant"
on public.tenant_salon_inventory_products
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_salon_inventory_products.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_salon_inventory_movements_read_own_tenant"
on public.tenant_salon_inventory_movements;

create policy "tenant_salon_inventory_movements_read_own_tenant"
on public.tenant_salon_inventory_movements
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_salon_inventory_movements.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

create or replace function public.admin_create_salon_inventory_purchase(
  p_tenant_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit_cost_cents integer,
  p_sku text default null,
  p_supplier text default null,
  p_notes text default null
)
returns table (
  product_id uuid,
  movement_id uuid,
  service_revenue_event_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_product_id uuid;
  v_movement_id uuid;
  v_event_id uuid;
  v_name text;
  v_sku text;
  v_supplier text;
  v_notes text;
  v_quantity numeric(12, 3);
  v_unit_cost_cents integer;
  v_total_cost_cents integer;
begin
  v_name := nullif(trim(coalesce(p_name, '')), '');
  v_sku := nullif(trim(coalesce(p_sku, '')), '');
  v_supplier := nullif(trim(coalesce(p_supplier, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  v_quantity := p_quantity;
  v_unit_cost_cents := coalesce(p_unit_cost_cents, 0);

  if v_name is null then
    raise exception 'product_name_required';
  end if;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'quantity_must_be_positive';
  end if;

  if v_unit_cost_cents <= 0 then
    raise exception 'unit_cost_must_be_positive';
  end if;

  v_total_cost_cents := round(v_quantity * v_unit_cost_cents)::integer;

  select t.id, t.plan, t.status, t.business_type
    into v_tenant
  from public.tenants t
  where t.id = p_tenant_id;

  if v_tenant.id is null
    or v_tenant.status <> 'active'
    or v_tenant.business_type <> 'salon'
    or v_tenant.plan not in ('plan2', 'plan3') then
    raise exception 'tenant_cannot_use_salon_inventory';
  end if;

  select product.id
    into v_product_id
  from public.tenant_salon_inventory_products product
  where product.tenant_id = p_tenant_id
    and lower(product.name) = lower(v_name)
  limit 1;

  if v_product_id is null then
    insert into public.tenant_salon_inventory_products (
      tenant_id,
      name,
      sku,
      current_quantity,
      unit_cost_cents,
      total_cost_cents
    )
    values (
      p_tenant_id,
      v_name,
      v_sku,
      v_quantity,
      v_unit_cost_cents,
      v_total_cost_cents
    )
    returning id into v_product_id;
  else
    update public.tenant_salon_inventory_products
       set current_quantity = current_quantity + v_quantity,
           unit_cost_cents = v_unit_cost_cents,
           total_cost_cents = total_cost_cents + v_total_cost_cents,
           sku = coalesce(v_sku, sku),
           is_active = true,
           updated_at = now()
     where id = v_product_id;
  end if;

  insert into public.tenant_service_revenue_events (
    tenant_id,
    appointment_id,
    amount_cents,
    currency,
    status,
    source,
    recognized_at,
    service_name_snapshot,
    payload
  )
  values (
    p_tenant_id,
    null,
    -v_total_cost_cents,
    'BRL',
    'recognized',
    'stock_purchase',
    now(),
    concat('Compra de estoque: ', v_name),
    jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'unit_cost_cents', v_unit_cost_cents,
      'total_cost_cents', v_total_cost_cents,
      'supplier', v_supplier,
      'notes', v_notes
    )
  )
  returning id into v_event_id;

  insert into public.tenant_salon_inventory_movements (
    tenant_id,
    product_id,
    movement_type,
    quantity_delta,
    unit_cost_cents,
    total_cost_cents,
    supplier,
    notes,
    service_revenue_event_id
  )
  values (
    p_tenant_id,
    v_product_id,
    'purchase',
    v_quantity,
    v_unit_cost_cents,
    v_total_cost_cents,
    v_supplier,
    v_notes,
    v_event_id
  )
  returning id into v_movement_id;

  return query select v_product_id, v_movement_id, v_event_id;
end;
$$;

grant execute on function public.admin_create_salon_inventory_purchase(uuid, text, numeric, integer, text, text, text)
to authenticated, service_role;
