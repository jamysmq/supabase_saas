-- Retains WhatsApp message content for six months and purges it daily.
-- Thread rows remain available as operational records without old previews.

create index if not exists tenant_whatsapp_messages_retention_idx
on public.tenant_whatsapp_messages(created_at);

create index if not exists platform_whatsapp_messages_retention_idx
on public.platform_whatsapp_messages(created_at);

create or replace function public.admin_purge_expired_whatsapp_messages(
  p_cutoff timestamptz default now() - interval '6 months'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_messages integer := 0;
  v_platform_messages integer := 0;
  v_tenant_threads_sanitized integer := 0;
  v_platform_threads_sanitized integer := 0;
begin
  delete from public.tenant_whatsapp_messages
  where created_at < p_cutoff;
  get diagnostics v_tenant_messages = row_count;

  delete from public.platform_whatsapp_messages
  where created_at < p_cutoff;
  get diagnostics v_platform_messages = row_count;

  update public.tenant_whatsapp_threads
  set last_message_preview = null, updated_at = now()
  where last_message_at < p_cutoff
    and last_message_preview is not null;
  get diagnostics v_tenant_threads_sanitized = row_count;

  update public.platform_whatsapp_threads
  set last_message_preview = null, updated_at = now()
  where last_message_at < p_cutoff
    and last_message_preview is not null;
  get diagnostics v_platform_threads_sanitized = row_count;

  return jsonb_build_object(
    'ok', true,
    'cutoff', p_cutoff,
    'tenant_messages_deleted', v_tenant_messages,
    'platform_messages_deleted', v_platform_messages,
    'tenant_threads_sanitized', v_tenant_threads_sanitized,
    'platform_threads_sanitized', v_platform_threads_sanitized
  );
end;
$$;

revoke all on function public.admin_purge_expired_whatsapp_messages(timestamptz)
from public, anon, authenticated;
grant execute on function public.admin_purge_expired_whatsapp_messages(timestamptz)
to service_role;

create extension if not exists pg_cron;

-- Apply the policy immediately, then keep it enforced every day.
select public.admin_purge_expired_whatsapp_messages();

select cron.schedule(
  'whatsapp-message-retention-six-months',
  '17 3 * * *',
  $$select public.admin_purge_expired_whatsapp_messages();$$
);
