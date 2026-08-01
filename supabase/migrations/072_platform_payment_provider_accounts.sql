-- Non-secret account metadata for payment providers owned by the platform.
-- Provider credentials remain exclusively in the server environment.

create table if not exists public.platform_payment_provider_accounts (
  provider text primary key,
  status text not null default 'disabled',
  provider_account_id text not null unique,
  provider_account_name text,
  credential_source text not null default 'environment',
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_validated_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_payment_provider_accounts_provider_chk
    check (provider in ('mercado_pago', 'asaas')),
  constraint platform_payment_provider_accounts_status_chk
    check (status in ('connected', 'needs_reauthorization', 'disabled', 'error')),
  constraint platform_payment_provider_accounts_credential_source_chk
    check (credential_source = 'environment')
);

alter table public.platform_payment_provider_accounts enable row level security;

revoke all on table public.platform_payment_provider_accounts
from public, anon, authenticated;

grant select, insert, update on table public.platform_payment_provider_accounts
to service_role;

comment on table public.platform_payment_provider_accounts is
  'Server-only non-secret metadata for official platform payment accounts. Credentials and tokens must never be stored in this table.';
