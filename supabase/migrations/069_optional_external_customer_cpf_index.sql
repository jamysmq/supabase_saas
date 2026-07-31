-- The legacy full unique index treats the empty string used for an omitted CPF
-- as a real value, allowing only one no-CPF customer per tenant. The partial
-- index below preserves uniqueness for informed CPFs while allowing omission.
drop index if exists public.end_customers_cpf_uq;

create unique index if not exists end_customers_tenant_cpf_uidx
on public.end_customers (tenant_id, cpf)
where cpf is not null and cpf <> '';
