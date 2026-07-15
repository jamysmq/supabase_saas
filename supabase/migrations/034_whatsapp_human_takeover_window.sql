-- Manual inbox replies pause Jack automation for two hours.
-- Inbound messages remain recorded in the inbox during the pause.

alter table public.tenant_whatsapp_threads
add column if not exists human_takeover_until timestamptz;

alter table public.platform_whatsapp_threads
add column if not exists human_takeover_until timestamptz;

comment on column public.tenant_whatsapp_threads.human_takeover_until is
  'Jack automation remains paused through this instant after a manual tenant reply.';

comment on column public.platform_whatsapp_threads.human_takeover_until is
  'Jack automation remains paused through this instant after a manual platform reply.';
