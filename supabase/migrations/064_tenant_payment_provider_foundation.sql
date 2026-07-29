-- Payment provider foundation for tenant receivables.
-- This migration does not enable automation, connect providers or create charges.

alter table public.tenant_billing_settings
  add column if not exists payment_automation_enabled boolean not null default false,
  add column if not exists pix_collection_mode text not null default 'tenant_key',
  add column if not exists default_payment_provider text;

alter table public.tenant_billing_settings
  drop constraint if exists tenant_billing_settings_pix_collection_mode_chk;

alter table public.tenant_billing_settings
  add constraint tenant_billing_settings_pix_collection_mode_chk
  check (pix_collection_mode in ('tenant_key', 'provider_dynamic'));

alter table public.tenant_billing_settings
  drop constraint if exists tenant_billing_settings_default_payment_provider_chk;

alter table public.tenant_billing_settings
  add constraint tenant_billing_settings_default_payment_provider_chk
  check (
    default_payment_provider is null
    or default_payment_provider in ('mercado_pago', 'asaas')
  );

create table if not exists public.tenant_payment_provider_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null,
  connection_mode text not null,
  status text not null default 'pending',
  provider_account_id text,
  provider_account_name text,
  credentials_ciphertext text,
  credentials_key_version integer not null default 1,
  granted_scopes text[] not null default '{}'::text[],
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  token_expires_at timestamptz,
  connected_at timestamptz,
  disconnected_at timestamptz,
  last_validated_at timestamptz,
  last_error_code text,
  created_by_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_payment_provider_connections_provider_chk
    check (provider in ('mercado_pago', 'asaas')),
  constraint tenant_payment_provider_connections_mode_chk
    check (connection_mode in ('oauth', 'api_key', 'subaccount')),
  constraint tenant_payment_provider_connections_status_chk
    check (status in ('pending', 'connected', 'needs_reauthorization', 'disabled', 'error')),
  constraint tenant_payment_provider_connections_key_version_chk
    check (credentials_key_version > 0),
  constraint tenant_payment_provider_connections_scope_uq
    unique (id, tenant_id, provider),
  constraint tenant_payment_provider_connections_tenant_provider_uq
    unique (tenant_id, provider)
);

create unique index if not exists tenant_payment_provider_connections_account_uq
on public.tenant_payment_provider_connections(provider, provider_account_id)
where provider_account_id is not null
  and status in ('connected', 'needs_reauthorization');

create index if not exists tenant_payment_provider_connections_tenant_status_idx
on public.tenant_payment_provider_connections(tenant_id, status, provider);

create table if not exists public.tenant_payment_provider_charges (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  customer_id uuid references public.tenant_customers(id) on delete set null,
  provider text not null,
  provider_charge_id text not null,
  external_reference text not null,
  payment_method text not null,
  status text not null default 'created',
  amount_cents integer not null,
  fee_cents integer,
  net_amount_cents integer,
  currency text not null default 'BRL',
  checkout_url text,
  pix_copy_paste text,
  pix_expires_at timestamptz,
  due_date date,
  paid_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_payment_provider_charges_provider_chk
    check (provider in ('mercado_pago', 'asaas')),
  constraint tenant_payment_provider_charges_method_chk
    check (payment_method in ('pix', 'credit_card')),
  constraint tenant_payment_provider_charges_status_chk
    check (status in ('created', 'pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded', 'chargeback')),
  constraint tenant_payment_provider_charges_amount_chk
    check (amount_cents > 0),
  constraint tenant_payment_provider_charges_fee_chk
    check (fee_cents is null or fee_cents >= 0),
  constraint tenant_payment_provider_charges_net_amount_chk
    check (net_amount_cents is null or net_amount_cents >= 0),
  constraint tenant_payment_provider_charges_currency_chk
    check (currency = 'BRL'),
  constraint tenant_payment_provider_charges_connection_scope_fk
    foreign key (connection_id, tenant_id, provider)
    references public.tenant_payment_provider_connections(id, tenant_id, provider)
    on delete cascade,
  constraint tenant_payment_provider_charges_scope_uq
    unique (id, tenant_id, connection_id, provider),
  constraint tenant_payment_provider_charges_connection_charge_uq
    unique (connection_id, provider_charge_id),
  constraint tenant_payment_provider_charges_external_reference_uq
    unique (tenant_id, external_reference)
);

create index if not exists tenant_payment_provider_charges_cycle_idx
on public.tenant_payment_provider_charges(tenant_id, billing_cycle_id, created_at desc);

create index if not exists tenant_payment_provider_charges_status_idx
on public.tenant_payment_provider_charges(tenant_id, status, due_date);

create table if not exists public.tenant_payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  charge_id uuid,
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  resource_type text,
  provider_resource_id text,
  processing_status text not null default 'received',
  processing_attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_payment_provider_events_provider_chk
    check (provider in ('mercado_pago', 'asaas')),
  constraint tenant_payment_provider_events_status_chk
    check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  constraint tenant_payment_provider_events_attempts_chk
    check (processing_attempts >= 0),
  constraint tenant_payment_provider_events_connection_scope_fk
    foreign key (connection_id, tenant_id, provider)
    references public.tenant_payment_provider_connections(id, tenant_id, provider)
    on delete cascade,
  constraint tenant_payment_provider_events_charge_scope_fk
    foreign key (charge_id, tenant_id, connection_id, provider)
    references public.tenant_payment_provider_charges(id, tenant_id, connection_id, provider)
    on delete cascade,
  constraint tenant_payment_provider_events_provider_event_uq
    unique (provider, provider_event_id)
);

create index if not exists tenant_payment_provider_events_processing_idx
on public.tenant_payment_provider_events(processing_status, received_at);

create index if not exists tenant_payment_provider_events_tenant_idx
on public.tenant_payment_provider_events(tenant_id, received_at desc);

alter table public.tenant_payment_provider_connections enable row level security;
alter table public.tenant_payment_provider_charges enable row level security;
alter table public.tenant_payment_provider_events enable row level security;

revoke all on public.tenant_payment_provider_connections from anon, authenticated;
revoke all on public.tenant_payment_provider_charges from anon, authenticated;
revoke all on public.tenant_payment_provider_events from anon, authenticated;

grant select, insert, update, delete
on public.tenant_payment_provider_connections,
   public.tenant_payment_provider_charges,
   public.tenant_payment_provider_events
to service_role;

drop policy if exists "tenant_payment_provider_connections_no_client_access"
on public.tenant_payment_provider_connections;
create policy "tenant_payment_provider_connections_no_client_access"
on public.tenant_payment_provider_connections
for select to authenticated
using (false);

drop policy if exists "tenant_payment_provider_charges_no_client_access"
on public.tenant_payment_provider_charges;
create policy "tenant_payment_provider_charges_no_client_access"
on public.tenant_payment_provider_charges
for select to authenticated
using (false);

drop policy if exists "tenant_payment_provider_events_no_client_access"
on public.tenant_payment_provider_events;
create policy "tenant_payment_provider_events_no_client_access"
on public.tenant_payment_provider_events
for select to authenticated
using (false);

comment on column public.tenant_payment_provider_connections.credentials_ciphertext is
  'Encrypted provider credential bundle. Never expose through client APIs or logs.';

comment on column public.tenant_payment_provider_charges.provider_payload is
  'Restricted provider snapshot for reconciliation. Service role only.';

comment on column public.tenant_payment_provider_events.payload is
  'Restricted raw webhook payload. Service role only.';
