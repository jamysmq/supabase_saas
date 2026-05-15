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
