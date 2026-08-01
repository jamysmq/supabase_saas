-- Recurring subscriptions paid by tenants to the official platform account.
-- Provider credentials remain exclusively in the server environment.

create table if not exists public.platform_payment_provider_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  billing_profile_id uuid not null references public.platform_tenant_billing_profiles(id) on delete restrict,
  provider text not null default 'mercado_pago',
  provider_subscription_id text,
  external_reference text not null unique,
  status text not null default 'creating',
  payer_email text not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  checkout_url text,
  provider_payment_method_id text,
  provider_payer_id text,
  next_payment_at timestamptz,
  authorized_at timestamptz,
  cancelled_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  created_by_auth_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_provider_subscriptions_provider_chk
    check (provider = 'mercado_pago'),
  constraint platform_provider_subscriptions_status_chk
    check (status in ('creating', 'pending', 'authorized', 'paused', 'cancelled', 'error')),
  constraint platform_provider_subscriptions_amount_chk
    check (amount_cents > 0),
  constraint platform_provider_subscriptions_currency_chk
    check (currency = 'BRL'),
  constraint platform_provider_subscriptions_provider_id_uq
    unique (provider, provider_subscription_id),
  constraint platform_provider_subscriptions_tenant_id_uq
    unique (tenant_id, id)
);

create unique index if not exists platform_provider_subscriptions_current_uq
on public.platform_payment_provider_subscriptions (tenant_id, provider)
where status in ('creating', 'pending', 'authorized', 'paused');

create index if not exists platform_provider_subscriptions_profile_created_idx
on public.platform_payment_provider_subscriptions (billing_profile_id, created_at desc);

alter table public.platform_payment_provider_subscriptions enable row level security;

revoke all on table public.platform_payment_provider_subscriptions
from public, anon, authenticated;

grant select, insert, update on table public.platform_payment_provider_subscriptions
to service_role;

comment on table public.platform_payment_provider_subscriptions is
  'Server-only recurring subscriptions paid by tenants to the official platform payment account.';

