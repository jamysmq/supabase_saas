create table if not exists public.tenant_payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  billing_profile_id uuid references public.customer_billing_profiles(id) on delete set null,
  customer_id uuid references public.tenant_customers(id) on delete set null,
  tenant_user_id uuid references public.tenant_users(id) on delete set null,
  event_type text not null default 'payment_status',
  old_status text,
  new_status text not null,
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists tenant_payment_events_tenant_created_idx
on public.tenant_payment_events (tenant_id, created_at desc);

create index if not exists tenant_payment_events_billing_cycle_created_idx
on public.tenant_payment_events (billing_cycle_id, created_at desc);

create index if not exists tenant_payment_events_billing_profile_created_idx
on public.tenant_payment_events (billing_profile_id, created_at desc);

alter table public.tenant_payment_events enable row level security;

grant select
on public.tenant_payment_events
to authenticated;

grant select, insert, update, delete
on public.tenant_payment_events
to service_role;

drop policy if exists "tenant_payment_events_read_own_tenant" on public.tenant_payment_events;
create policy "tenant_payment_events_read_own_tenant"
on public.tenant_payment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_payment_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);
