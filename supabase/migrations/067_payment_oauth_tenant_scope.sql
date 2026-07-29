-- Ensure an OAuth attempt cannot reference a tenant user from another tenant.

alter table public.tenant_users
  add constraint tenant_users_id_tenant_uq unique (id, tenant_id);

alter table public.tenant_payment_provider_oauth_states
  add constraint tenant_payment_provider_oauth_states_user_scope_fk
  foreign key (tenant_user_id, tenant_id)
  references public.tenant_users(id, tenant_id)
  on delete cascade;
