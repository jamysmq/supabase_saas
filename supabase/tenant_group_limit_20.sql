update public.tenant_billing_settings
set max_customer_groups = 20,
    updated_at = now()
where max_customer_groups is distinct from 20;

alter table public.tenant_billing_settings
alter column max_customer_groups set default 20;
