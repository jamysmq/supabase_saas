alter table public.payments
add column if not exists deleted_at timestamptz,
add column if not exists confirmed_source text,
add column if not exists confirmed_note text;

alter table public.payments
drop constraint if exists payments_status_check;

alter table public.payments
add constraint payments_status_check
check (status in ('pending', 'paid', 'deleted', 'cancelled', 'failed'));

create table if not exists public.platform_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  billing_profile_id uuid references public.platform_tenant_billing_profiles(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  platform_admin_auth_user_id uuid,
  event_type text not null default 'payment_status',
  old_status text,
  new_status text not null,
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now()
);

alter table public.platform_payment_events
add column if not exists billing_profile_id uuid references public.platform_tenant_billing_profiles(id) on delete set null,
add column if not exists event_type text not null default 'payment_status',
add column if not exists tenant_legal_name_snapshot text,
add column if not exists tenant_email_snapshot text,
add column if not exists tenant_cpf_snapshot text,
add column if not exists tenant_whatsapp_snapshot text,
add column if not exists tenant_business_type_snapshot text,
add column if not exists tenant_plan_snapshot text;

create index if not exists platform_payment_events_billing_profile_created_idx
on public.platform_payment_events (billing_profile_id, created_at desc);

create index if not exists platform_payment_events_payment_created_idx
on public.platform_payment_events (payment_id, created_at desc);

create index if not exists platform_payment_events_tenant_created_idx
on public.platform_payment_events (tenant_id, created_at desc);

alter table public.platform_payment_events enable row level security;

grant select, insert, update, delete
on public.platform_payment_events
to service_role;

drop policy if exists "platform_payment_events_no_client_access" on public.platform_payment_events;
create policy "platform_payment_events_no_client_access"
on public.platform_payment_events
for select
to authenticated
using (false);
