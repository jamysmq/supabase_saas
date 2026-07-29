-- One-time OAuth state and PKCE storage for tenant payment provider connections.

create table if not exists public.tenant_payment_provider_oauth_states (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_user_id uuid not null references public.tenant_users(id) on delete cascade,
  provider text not null,
  state_hash text not null,
  code_verifier_ciphertext text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_payment_provider_oauth_states_provider_chk
    check (provider in ('mercado_pago', 'asaas')),
  constraint tenant_payment_provider_oauth_states_hash_uq
    unique (state_hash),
  constraint tenant_payment_provider_oauth_states_expiry_chk
    check (expires_at > created_at)
);

create index if not exists tenant_payment_provider_oauth_states_expiry_idx
on public.tenant_payment_provider_oauth_states(expires_at)
where used_at is null;

create index if not exists tenant_payment_provider_oauth_states_tenant_idx
on public.tenant_payment_provider_oauth_states(tenant_id, tenant_user_id, provider, created_at desc);

alter table public.tenant_payment_provider_oauth_states enable row level security;

revoke all on public.tenant_payment_provider_oauth_states from anon, authenticated;

grant select, insert, update, delete
on public.tenant_payment_provider_oauth_states
to service_role;

drop policy if exists "tenant_payment_provider_oauth_states_no_client_access"
on public.tenant_payment_provider_oauth_states;
create policy "tenant_payment_provider_oauth_states_no_client_access"
on public.tenant_payment_provider_oauth_states
for select to authenticated
using (false);

comment on table public.tenant_payment_provider_oauth_states is
  'Short-lived, one-time OAuth CSRF state and encrypted PKCE verifier. Service role only.';
