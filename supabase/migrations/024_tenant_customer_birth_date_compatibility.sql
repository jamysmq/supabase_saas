-- Restores the customer field expected by the WhatsApp appointment RPCs.
-- Existing customers remain unchanged; the value is collected only when needed.

alter table public.tenant_customers
add column if not exists birth_date date;
