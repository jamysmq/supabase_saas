-- Migration: 006_security_and_grants.sql
-- Generated from existing loose SQL files. Keep source files until this is tested in staging.
-- Source files:
-- - supabase/public_data_api_grants.sql
-- - supabase/security_hardening_rls.sql


-- ============================================================
-- Source: supabase/public_data_api_grants.sql
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant select
on public.platform_plans
to anon;

grant select, insert, update, delete
on public.customer_billing_profiles,
   public.tenant_billing_settings,
   public.tenant_customer_groups,
   public.tenant_customers,
   public.tenant_users,
   public.tenants
to authenticated;

grant select, insert, update, delete
on public.appointments,
   public.billing_cycles,
   public.customer_billing_profiles,
   public.end_customer_group_membership,
   public.end_customers,
   public.groups,
   public.payments,
   public.platform_admins,
   public.platform_plans,
   public.platform_tenant_billing_profiles,
   public.subscriptions,
   public.tenant_billing_settings,
   public.tenant_customer_groups,
   public.tenant_customers,
   public.tenant_message_templates,
   public.tenant_plan_features,
   public.tenant_services,
   public.tenant_staff_members,
   public.tenant_users,
   public.tenant_whatsapp_numbers,
   public.tenant_whatsapp_routing,
   public.tenants,
   public.wa_conversations,
   public.wa_payments,
   public.webhook_events
to service_role;

alter default privileges in schema public
grant select, insert, update, delete on tables to service_role;


-- ============================================================
-- Source: supabase/security_hardening_rls.sql
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select
on public.platform_plans
to anon, authenticated;

grant select, insert, update, delete
on public.customer_billing_profiles,
   public.tenant_billing_settings,
   public.tenant_customer_groups,
   public.tenant_customers,
   public.tenant_users,
   public.tenants
to authenticated;

grant select, insert, update, delete
on all tables in schema public
to service_role;

grant select
on public.tenant_plan_features
to authenticated, service_role;

grant select
on public.tenant_whatsapp_routing
to authenticated, service_role;

do $$
declare
  rel_name text;
  rel_names text[] := array[
    'appointments',
    'appointment_status_events',
    'billing_cycles',
    'customer_billing_profiles',
    'end_customer_group_membership',
    'end_customers',
    'groups',
    'payments',
    'platform_admins',
    'platform_payment_events',
    'platform_plans',
    'platform_tenant_billing_profiles',
    'subscriptions',
    'tenant_billing_settings',
    'tenant_customer_groups',
    'tenant_customers',
    'tenant_message_templates',
    'tenant_payment_events',
    'tenant_plan_features',
    'tenant_services',
    'tenant_staff_members',
    'tenant_users',
    'tenant_whatsapp_numbers',
    'tenant_whatsapp_routing',
    'tenants',
    'wa_conversations',
    'wa_payments',
    'webhook_events'
  ];
begin
  foreach rel_name in array rel_names loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = rel_name
        and c.relkind in ('r', 'p')
    ) then
      execute format('alter table public.%I enable row level security', rel_name);
    end if;
  end loop;
end $$;

drop policy if exists "platform_plans_are_public_read" on public.platform_plans;
create policy "platform_plans_are_public_read"
on public.platform_plans
for select
to anon, authenticated
using (true);

drop policy if exists "tenant_users_read_own_user" on public.tenant_users;
create policy "tenant_users_read_own_user"
on public.tenant_users
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "tenant_users_update_own_password_flags" on public.tenant_users;
create policy "tenant_users_update_own_password_flags"
on public.tenant_users
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "tenants_read_own_tenant" on public.tenants;
create policy "tenants_read_own_tenant"
on public.tenants
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenants.id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_billing_settings_read_own_tenant" on public.tenant_billing_settings;
create policy "tenant_billing_settings_read_own_tenant"
on public.tenant_billing_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_billing_settings.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_customer_groups_manage_own_tenant" on public.tenant_customer_groups;
create policy "tenant_customer_groups_manage_own_tenant"
on public.tenant_customer_groups
for all
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_customer_groups.tenant_id
      and tu.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_customer_groups.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_customers_manage_own_tenant" on public.tenant_customers;
create policy "tenant_customers_manage_own_tenant"
on public.tenant_customers
for all
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_customers.tenant_id
      and tu.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_customers.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "customer_billing_profiles_manage_own_tenant" on public.customer_billing_profiles;
create policy "customer_billing_profiles_manage_own_tenant"
on public.customer_billing_profiles
for all
to authenticated
using (
  exists (
    select 1
    from public.tenant_customers tc
    join public.tenant_users tu on tu.tenant_id = tc.tenant_id
    where tc.id = customer_billing_profiles.customer_id
      and tu.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.tenant_customers tc
    join public.tenant_users tu on tu.tenant_id = tc.tenant_id
    where tc.id = customer_billing_profiles.customer_id
      and tu.auth_user_id = auth.uid()
  )
);

alter default privileges in schema public
grant select, insert, update, delete on tables to service_role;

