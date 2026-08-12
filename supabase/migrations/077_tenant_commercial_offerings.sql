create table if not exists public.tenant_commercial_offerings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  offer_type text not null,
  name text not null,
  description text,
  price_cents integer not null,
  price_unit text not null,
  custom_unit_label text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_commercial_offerings_type_check
    check (offer_type in ('membership', 'rental')),
  constraint tenant_commercial_offerings_name_check
    check (char_length(trim(name)) between 1 and 80),
  constraint tenant_commercial_offerings_description_check
    check (description is null or char_length(description) <= 500),
  constraint tenant_commercial_offerings_price_check
    check (price_cents >= 0),
  constraint tenant_commercial_offerings_unit_check
    check (price_unit in ('monthly', 'hourly', 'daily', 'per_class', 'per_session', 'package', 'one_time', 'custom')),
  constraint tenant_commercial_offerings_custom_unit_check
    check (
      (price_unit = 'custom' and nullif(trim(custom_unit_label), '') is not null)
      or price_unit <> 'custom'
    )
);

create index if not exists tenant_commercial_offerings_active_idx
on public.tenant_commercial_offerings (tenant_id, offer_type, sort_order, name)
where is_active = true;

alter table public.tenant_commercial_offerings enable row level security;

drop policy if exists "tenant_commercial_offerings_read_own_tenant"
on public.tenant_commercial_offerings;
create policy "tenant_commercial_offerings_read_own_tenant"
on public.tenant_commercial_offerings
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = tenant_commercial_offerings.tenant_id
      and tenant_user.auth_user_id = auth.uid()
  )
);

grant select on public.tenant_commercial_offerings to authenticated;
grant select, insert, update, delete on public.tenant_commercial_offerings to service_role;

comment on table public.tenant_commercial_offerings is
  'Commercial plans, modalities, and rental prices published by each tenant on WhatsApp.';
