-- Generalizes the existing salon inventory without moving production data.
-- The physical table names remain for backward compatibility, while the new
-- RPC contract supports salon tenants and catalog tenants on plans 4 and 5.

alter table public.tenant_salon_inventory_products
  drop constraint if exists tenant_salon_inventory_products_quantity_check;

alter table public.tenant_salon_inventory_products
  add constraint tenant_salon_inventory_products_quantity_check
  check (current_quantity >= 0 and total_cost_cents >= 0 and unit_cost_cents >= 0);

alter table public.tenant_salon_inventory_movements
  add column if not exists tenant_user_id uuid references public.tenant_users(id) on delete set null,
  add column if not exists source text not null default 'panel',
  add column if not exists idempotency_key text;

create unique index if not exists tenant_salon_inventory_movements_idempotency_uidx
on public.tenant_salon_inventory_movements (tenant_id, idempotency_key)
where idempotency_key is not null;

create or replace function public.admin_create_inventory_purchase(
  p_tenant_id uuid,
  p_tenant_user_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit_cost_cents integer,
  p_sku text default null,
  p_supplier text default null,
  p_notes text default null,
  p_idempotency_key text default null,
  p_source text default 'panel'
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
  v_existing_movement public.tenant_salon_inventory_movements%rowtype;
  v_product public.tenant_salon_inventory_products%rowtype;
  v_product_id uuid;
  v_movement_id uuid;
  v_event_id uuid;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_sku text := nullif(trim(coalesce(p_sku, '')), '');
  v_supplier text := nullif(trim(coalesce(p_supplier, '')), '');
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_source, '')), ''), 'panel');
  v_quantity numeric(12, 3) := p_quantity;
  v_unit_cost_cents integer := coalesce(p_unit_cost_cents, 0);
  v_purchase_total integer;
  v_new_quantity numeric(12, 3);
  v_new_total integer;
  v_average_cost integer;
begin
  if v_name is null then raise exception 'product_name_required'; end if;
  if v_quantity is null or v_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;
  if v_unit_cost_cents <= 0 then raise exception 'unit_cost_must_be_positive'; end if;

  if p_tenant_user_id is not null and not exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.id = p_tenant_user_id
      and tenant_user.tenant_id = p_tenant_id
  ) then
    raise exception 'tenant_user_not_allowed';
  end if;

  select tenant.id, tenant.plan, tenant.status, tenant.business_type
  into v_tenant
  from public.tenants tenant
  where tenant.id = p_tenant_id;

  if v_tenant.id is null
     or v_tenant.status <> 'active'
     or not (
       (v_tenant.business_type = 'salon' and v_tenant.plan in ('plan2', 'plan3'))
       or v_tenant.plan in ('plan4', 'plan5')
     ) then
    raise exception 'tenant_cannot_use_inventory';
  end if;

  if v_idempotency_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('inventory-idempotency:' || p_tenant_id::text || ':' || v_idempotency_key, 0)
    );

    select movement.*
    into v_existing_movement
    from public.tenant_salon_inventory_movements movement
    where movement.tenant_id = p_tenant_id
      and movement.idempotency_key = v_idempotency_key;

    if v_existing_movement.id is not null then
      return query select
        v_existing_movement.product_id,
        v_existing_movement.id,
        v_existing_movement.service_revenue_event_id;
      return;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || lower(v_name), 0));

  select product.*
  into v_product
  from public.tenant_salon_inventory_products product
  where product.tenant_id = p_tenant_id
    and lower(product.name) = lower(v_name)
  limit 1
  for update;

  v_purchase_total := round(v_quantity * v_unit_cost_cents)::integer;

  if v_product.id is null then
    insert into public.tenant_salon_inventory_products (
      tenant_id, name, sku, current_quantity,
      unit_cost_cents, total_cost_cents, is_active
    ) values (
      p_tenant_id, v_name, v_sku, v_quantity,
      v_unit_cost_cents, v_purchase_total, true
    )
    returning id into v_product_id;
  else
    v_new_quantity := v_product.current_quantity + v_quantity;
    v_new_total := v_product.total_cost_cents + v_purchase_total;
    v_average_cost := case
      when v_new_quantity > 0 then round(v_new_total / v_new_quantity)::integer
      else 0
    end;

    update public.tenant_salon_inventory_products product
    set current_quantity = v_new_quantity,
        unit_cost_cents = v_average_cost,
        total_cost_cents = v_new_total,
        sku = coalesce(v_sku, product.sku),
        is_active = true,
        updated_at = now()
    where product.id = v_product.id
    returning product.id into v_product_id;
  end if;

  insert into public.tenant_service_revenue_events (
    tenant_id, appointment_id, amount_cents, currency, status, source,
    recognized_at, service_name_snapshot, payload
  ) values (
    p_tenant_id, null, -v_purchase_total, 'BRL', 'recognized',
    'stock_purchase', now(), concat('Compra de estoque: ', v_name),
    jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_quantity,
      'unit_cost_cents', v_unit_cost_cents,
      'total_cost_cents', v_purchase_total,
      'supplier', v_supplier,
      'notes', v_notes,
      'source', v_source
    )
  )
  returning id into v_event_id;

  insert into public.tenant_salon_inventory_movements (
    tenant_id, product_id, movement_type, quantity_delta,
    unit_cost_cents, total_cost_cents, supplier, notes,
    service_revenue_event_id, tenant_user_id, source, idempotency_key
  ) values (
    p_tenant_id, v_product_id, 'purchase', v_quantity,
    v_unit_cost_cents, v_purchase_total, v_supplier, v_notes,
    v_event_id, p_tenant_user_id, v_source, v_idempotency_key
  )
  returning id into v_movement_id;

  return query select v_product_id, v_movement_id, v_event_id;
end;
$$;

create or replace function public.admin_create_inventory_usage(
  p_tenant_id uuid,
  p_tenant_user_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text default null,
  p_idempotency_key text default null,
  p_source text default 'panel'
)
returns table (
  product_id uuid,
  movement_id uuid,
  current_quantity numeric,
  total_cost_cents integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_existing_movement public.tenant_salon_inventory_movements%rowtype;
  v_product public.tenant_salon_inventory_products%rowtype;
  v_movement_id uuid;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_source, '')), ''), 'panel');
  v_quantity numeric(12, 3) := p_quantity;
  v_average_cost integer;
  v_usage_total integer;
  v_new_quantity numeric(12, 3);
  v_new_total integer;
begin
  if v_quantity is null or v_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;

  if p_tenant_user_id is null or not exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.id = p_tenant_user_id
      and tenant_user.tenant_id = p_tenant_id
  ) then
    raise exception 'tenant_user_not_allowed';
  end if;

  select tenant.id, tenant.plan, tenant.status, tenant.business_type
  into v_tenant
  from public.tenants tenant
  where tenant.id = p_tenant_id;

  if v_tenant.id is null
     or v_tenant.status <> 'active'
     or not (
       (v_tenant.business_type = 'salon' and v_tenant.plan in ('plan2', 'plan3'))
       or v_tenant.plan in ('plan4', 'plan5')
     ) then
    raise exception 'tenant_cannot_use_inventory';
  end if;

  if v_idempotency_key is not null then
    perform pg_advisory_xact_lock(
      hashtextextended('inventory-idempotency:' || p_tenant_id::text || ':' || v_idempotency_key, 0)
    );

    select movement.*
    into v_existing_movement
    from public.tenant_salon_inventory_movements movement
    where movement.tenant_id = p_tenant_id
      and movement.idempotency_key = v_idempotency_key;

    if v_existing_movement.id is not null then
      select product.* into v_product
      from public.tenant_salon_inventory_products product
      where product.id = v_existing_movement.product_id;

      return query select
        v_existing_movement.product_id,
        v_existing_movement.id,
        v_product.current_quantity,
        v_product.total_cost_cents;
      return;
    end if;
  end if;

  select product.*
  into v_product
  from public.tenant_salon_inventory_products product
  where product.id = p_product_id
    and product.tenant_id = p_tenant_id
    and product.is_active = true
  for update;

  if v_product.id is null then raise exception 'inventory_product_not_found'; end if;
  if v_product.current_quantity < v_quantity then raise exception 'insufficient_inventory'; end if;

  v_average_cost := case
    when v_product.current_quantity > 0
      then round(v_product.total_cost_cents / v_product.current_quantity)::integer
    else 0
  end;
  v_usage_total := case
    when v_product.current_quantity = v_quantity then v_product.total_cost_cents
    else least(v_product.total_cost_cents, round(v_quantity * v_average_cost)::integer)
  end;
  v_new_quantity := v_product.current_quantity - v_quantity;
  v_new_total := greatest(v_product.total_cost_cents - v_usage_total, 0);

  update public.tenant_salon_inventory_products product
  set current_quantity = v_new_quantity,
      unit_cost_cents = case when v_new_quantity = 0 then 0 else v_average_cost end,
      total_cost_cents = v_new_total,
      updated_at = now()
  where product.id = v_product.id;

  insert into public.tenant_salon_inventory_movements (
    tenant_id, product_id, movement_type, quantity_delta,
    unit_cost_cents, total_cost_cents, notes,
    tenant_user_id, source, idempotency_key
  ) values (
    p_tenant_id, v_product.id, 'usage', -v_quantity,
    v_average_cost, v_usage_total, v_notes,
    p_tenant_user_id, v_source, v_idempotency_key
  )
  returning id into v_movement_id;

  return query select v_product.id, v_movement_id, v_new_quantity, v_new_total;
end;
$$;

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
language sql
security definer
set search_path = public
as $$
  select purchase.product_id, purchase.movement_id, purchase.service_revenue_event_id
  from public.admin_create_inventory_purchase(
    p_tenant_id,
    null,
    p_name,
    p_quantity,
    p_unit_cost_cents,
    p_sku,
    p_supplier,
    p_notes,
    null,
    'legacy_salon_api'
  ) purchase;
$$;

revoke all on function public.admin_create_inventory_purchase(uuid, uuid, text, numeric, integer, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.admin_create_inventory_purchase(uuid, uuid, text, numeric, integer, text, text, text, text, text)
to service_role;

revoke all on function public.admin_create_inventory_usage(uuid, uuid, uuid, numeric, text, text, text)
from public, anon, authenticated;
grant execute on function public.admin_create_inventory_usage(uuid, uuid, uuid, numeric, text, text, text)
to service_role;

revoke all on function public.admin_create_salon_inventory_purchase(uuid, text, numeric, integer, text, text, text)
from public, anon, authenticated;
grant execute on function public.admin_create_salon_inventory_purchase(uuid, text, numeric, integer, text, text, text)
to service_role;
