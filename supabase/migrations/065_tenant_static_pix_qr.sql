-- Static Pix QR support for tenant receivables.
-- Existing reminders keep working when the city is not configured.

alter table public.tenant_billing_settings
  add column if not exists pix_beneficiary_city text;

comment on column public.tenant_billing_settings.pix_beneficiary_city is
  'Merchant city used only to assemble a tenant-key static Pix BR Code.';
