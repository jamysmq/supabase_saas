-- Tracks Meta delivery callbacks for appointment notifications.

alter table public.appointment_reminder_events
add column if not exists provider_message_id text;

alter table public.appointment_reminder_events
add column if not exists delivery_status text not null default 'accepted';

alter table public.appointment_reminder_events
add column if not exists delivery_status_updated_at timestamptz;

alter table public.appointment_reminder_events
add column if not exists delivery_recipient_id text;

alter table public.appointment_reminder_events
add column if not exists delivery_error jsonb;

alter table public.appointment_reminder_events
drop constraint if exists appointment_reminder_events_delivery_status_check;

alter table public.appointment_reminder_events
add constraint appointment_reminder_events_delivery_status_check
check (delivery_status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted'));

update public.appointment_reminder_events
set provider_message_id = nullif(payload #>> '{provider_response,message_id}', ''),
    delivery_status_updated_at = coalesce(delivery_status_updated_at, sent_at)
where provider_message_id is null
   or delivery_status_updated_at is null;

create unique index if not exists appointment_reminder_events_provider_message_uidx
on public.appointment_reminder_events(provider_message_id)
where provider_message_id is not null;

create or replace function public.sync_appointment_reminder_provider_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.provider_message_id := coalesce(
    nullif(new.provider_message_id, ''),
    nullif(new.payload #>> '{provider_response,message_id}', '')
  );
  new.delivery_status := coalesce(nullif(new.delivery_status, ''), 'accepted');
  new.delivery_status_updated_at := coalesce(new.delivery_status_updated_at, new.sent_at, now());
  return new;
end;
$$;

drop trigger if exists appointment_reminder_provider_fields
on public.appointment_reminder_events;

create trigger appointment_reminder_provider_fields
before insert or update of payload, provider_message_id
on public.appointment_reminder_events
for each row
execute function public.sync_appointment_reminder_provider_fields();

revoke all on function public.sync_appointment_reminder_provider_fields()
from public, anon, authenticated;
