alter table public.platform_operational_incidents
  drop constraint if exists platform_operational_incidents_attempts_chk;

alter table public.platform_operational_incidents
  drop column if exists notified_at,
  drop column if exists resolution_notified_at,
  drop column if exists notification_attempts,
  drop column if exists provider_message_id,
  drop column if exists last_notification_error;

comment on table public.platform_operational_incidents is
  'Server-only operational incidents retained for Dashboard visibility and incident history.';
