-- Fixes PL/pgSQL ambiguity between the delivery_status output parameter and
-- the callback table column used by the idempotency conflict target.

create or replace function public.admin_record_billing_reminder_delivery_status(
  p_provider_message_id text,
  p_delivery_status text,
  p_status_updated_at timestamptz default now(),
  p_recipient_id text default null,
  p_delivery_error jsonb default null
)
returns table (
  reminder_event_id uuid,
  billing_cycle_id uuid,
  delivery_status text,
  cycle_marked_delivered boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.billing_reminder_events%rowtype;
  v_effective_status text;
  v_cycle_marked boolean := false;
begin
  if p_delivery_status is null
     or p_delivery_status not in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted') then
    raise exception 'invalid_billing_delivery_status';
  end if;
  if nullif(trim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'provider_message_id_required';
  end if;

  insert into public.billing_reminder_delivery_callbacks (
    provider_message_id, delivery_status, status_updated_at,
    recipient_id, delivery_error
  ) values (
    trim(p_provider_message_id),
    p_delivery_status,
    coalesce(p_status_updated_at, now()),
    nullif(trim(coalesce(p_recipient_id, '')), ''),
    p_delivery_error
  )
  on conflict on constraint billing_reminder_delivery_callbacks_event_uq
  do nothing;

  delete from public.billing_reminder_delivery_callbacks callback
  where callback.reminder_event_id is null
    and callback.created_at < now() - interval '7 days';

  select event.* into v_event
  from public.billing_reminder_events event
  where event.provider_message_id = trim(p_provider_message_id)
  for update;

  if v_event.id is null then return; end if;

  update public.billing_reminder_delivery_callbacks callback
  set reminder_event_id = v_event.id
  where callback.provider_message_id = trim(p_provider_message_id)
    and callback.reminder_event_id is null;

  v_effective_status := p_delivery_status;
  if v_event.delivery_status = 'read' then
    v_effective_status := 'read';
  elsif p_delivery_status = 'read' then
    v_effective_status := 'read';
  elsif v_event.delivery_status = 'delivered'
        and p_delivery_status in ('accepted', 'sent', 'failed', 'reserved') then
    v_effective_status := 'delivered';
  elsif p_delivery_status = 'delivered' then
    v_effective_status := 'delivered';
  elsif v_event.delivery_status = 'failed'
        and p_delivery_status in ('accepted', 'sent', 'reserved') then
    v_effective_status := 'failed';
  elsif v_event.delivery_status = 'deleted'
        and p_delivery_status not in ('delivered', 'read') then
    v_effective_status := 'deleted';
  end if;

  update public.billing_reminder_events
  set delivery_status = v_effective_status,
      delivery_status_updated_at = case
        when v_effective_status <> v_event.delivery_status
          then coalesce(p_status_updated_at, now())
        else delivery_status_updated_at
      end,
      delivery_recipient_id = coalesce(
        nullif(trim(coalesce(p_recipient_id, '')), ''),
        delivery_recipient_id
      ),
      delivery_error = case
        when v_effective_status = 'failed' then coalesce(p_delivery_error, '[]'::jsonb)
        else delivery_error
      end,
      sent_at = case
        when p_delivery_status = 'sent' then coalesce(sent_at, p_status_updated_at, now())
        else sent_at
      end,
      delivered_at = case
        when v_effective_status in ('delivered', 'read')
          then coalesce(delivered_at, p_status_updated_at, now())
        else delivered_at
      end,
      read_at = case
        when v_effective_status = 'read' then coalesce(read_at, p_status_updated_at, now())
        else read_at
      end,
      failed_at = case
        when v_effective_status = 'failed' then coalesce(failed_at, p_status_updated_at, now())
        else failed_at
      end,
      updated_at = now()
  where id = v_event.id;

  if v_effective_status in ('delivered', 'read') then
    update public.billing_cycles cycle
    set message_rendered = v_event.rendered_message,
        message_sent_at = coalesce(cycle.message_sent_at, p_status_updated_at, now()),
        updated_at = now()
    where cycle.id = v_event.billing_cycle_id
      and cycle.message_sent_at is null;
    v_cycle_marked := found;
  end if;

  reminder_event_id := v_event.id;
  billing_cycle_id := v_event.billing_cycle_id;
  delivery_status := v_effective_status;
  cycle_marked_delivered := v_cycle_marked;
  return next;
end;
$$;

revoke all on function public.admin_record_billing_reminder_delivery_status(
  text, text, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_record_billing_reminder_delivery_status(
  text, text, timestamptz, text, jsonb
) to service_role;
