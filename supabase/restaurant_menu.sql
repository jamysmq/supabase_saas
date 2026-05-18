create table if not exists public.tenant_menu_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_menu_items
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists group_id uuid,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists price_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists tenant_menu_items_tenant_active_idx
on public.tenant_menu_items (tenant_id, is_active, name);

alter table public.tenant_menu_items enable row level security;

grant select
on public.tenant_menu_items
to authenticated;

grant select, insert, update, delete
on public.tenant_menu_items
to service_role;

drop policy if exists "tenant_menu_items_read_own_tenant" on public.tenant_menu_items;
create policy "tenant_menu_items_read_own_tenant"
on public.tenant_menu_items
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_menu_items.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);
