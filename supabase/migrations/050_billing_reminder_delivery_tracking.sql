-- Aligns billing-cycle statuses and tracks proactive billing reminders from
-- provider acceptance through actual delivery, read or failure callbacks.

alter table public.billing_cycles
drop constraint if exists billing_cycles_status_chk;

alter table public.billing_cycles
add constraint billing_cycles_status_chk
check (status in (
  'pending',
  'overdue',
  'paid_manual',
  'paid_asaas',
  'canceled'
));

create table if not exists public.billing_reminder_events (
  id uuid primary key default gen_random_uuid(),
  billing_cycle_id uuid not null references public.billing_cycles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.tenant_customers(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 3),
  attempt_date date not null,
  notification_type text not null check (notification_type in ('due_today', 'overdue')),
  template_name text not null,
  recipient_e164 text not null,
  rendered_message text not null,
  provider_message_id text,
  delivery_status text not null default 'reserved'
    check (delivery_status in ('reserved', 'accepted', 'sent', 'delivered', 'read', 'failed', 'deleted')),
  delivery_status_updated_at timestamptz not null default now(),
  delivery_recipient_id text,
  delivery_error jsonb,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_reminder_events_cycle_attempt_uq
    unique (billing_cycle_id, attempt_number),
  constraint billing_reminder_events_cycle_attempt_date_uq
    unique (billing_cycle_id, attempt_date),
  constraint billing_reminder_events_provider_message_uq
    unique (provider_message_id)
);

create table if not exists public.billing_reminder_delivery_callbacks (
  id uuid primary key default gen_random_uuid(),
  reminder_event_id uuid references public.billing_reminder_events(id) on delete cascade,
  provider_message_id text not null,
  delivery_status text not null
    check (delivery_status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'deleted')),
  status_updated_at timestamptz not null,
  recipient_id text,
  delivery_error jsonb,
  created_at timestamptz not null default now(),
  constraint billing_reminder_delivery_callbacks_event_uq
    unique (provider_message_id, delivery_status, status_updated_at)
);

create index if not exists billing_reminder_events_cycle_created_idx
on public.billing_reminder_events(billing_cycle_id, created_at desc);

create index if not exists billing_reminder_events_tenant_created_idx
on public.billing_reminder_events(tenant_id, created_at desc);

create index if not exists billing_reminder_events_delivery_status_idx
on public.billing_reminder_events(delivery_status, delivery_status_updated_at desc);

create index if not exists billing_reminder_delivery_callbacks_message_idx
on public.billing_reminder_delivery_callbacks(provider_message_id, status_updated_at);

create index if not exists billing_reminder_delivery_callbacks_orphan_idx
on public.billing_reminder_delivery_callbacks(created_at)
where reminder_event_id is null;

alter table public.billing_reminder_events enable row level security;
alter table public.billing_reminder_delivery_callbacks enable row level security;

grant select, insert, update, delete
on public.billing_reminder_events
to service_role;

grant select, insert, update, delete
on public.billing_reminder_delivery_callbacks
to service_role;

create or replace function public.admin_generate_billing_cycles_for_all_tenants(
  p_reference_date date default current_date
)
returns table (
  generated_count integer,
  existing_count integer,
  reference_year integer,
  reference_month integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_due_date date;
  v_existing_cycle_id uuid;
  v_generated_count integer := 0;
  v_existing_count integer := 0;
begin
  update public.billing_cycles cycle
  set status = 'overdue',
      updated_at = now()
  from public.tenant_customers customer
  join public.tenants tenant on tenant.id = customer.tenant_id
  where cycle.customer_id = customer.id
    and cycle.tenant_id = tenant.id
    and cycle.status = 'pending'
    and cycle.due_date < p_reference_date
    and customer.is_active = true
    and tenant.status = 'active';

  for v_profile in
    select
      profile.id as billing_profile_id,
      profile.tenant_id,
      profile.customer_id,
      profile.amount_cents,
      profile.currency,
      profile.due_day,
      profile.message_template_key
    from public.customer_billing_profiles profile
    join public.tenant_customers customer on customer.id = profile.customer_id
    join public.tenants tenant on tenant.id = profile.tenant_id
    where profile.status = 'active'
      and customer.is_active = true
      and tenant.status = 'active'
      and tenant.plan in ('plan1', 'plan3')
  loop
    v_due_date := make_date(
      extract(year from p_reference_date)::integer,
      extract(month from p_reference_date)::integer,
      least(
        v_profile.due_day,
        extract(day from (
          date_trunc('month', p_reference_date) + interval '1 month - 1 day'
        ))::integer
      )
    );

    select cycle.id
    into v_existing_cycle_id
    from public.billing_cycles cycle
    where cycle.tenant_id = v_profile.tenant_id
      and cycle.customer_id = v_profile.customer_id
      and cycle.billing_profile_id = v_profile.billing_profile_id
      and cycle.reference_year = extract(year from v_due_date)::integer
      and cycle.reference_month = extract(month from v_due_date)::integer
    limit 1;

    if v_existing_cycle_id is null then
      insert into public.billing_cycles (
        tenant_id, customer_id, billing_profile_id, reference_year,
        reference_month, due_date, amount_cents, currency, status,
        message_template_key
      ) values (
        v_profile.tenant_id,
        v_profile.customer_id,
        v_profile.billing_profile_id,
        extract(year from v_due_date)::integer,
        extract(month from v_due_date)::integer,
        v_due_date,
        v_profile.amount_cents,
        v_profile.currency,
        case when v_due_date < p_reference_date then 'overdue' else 'pending' end,
        coalesce(v_profile.message_template_key, 'billing_reminder_due_today')
      );
      v_generated_count := v_generated_count + 1;
    else
      v_existing_count := v_existing_count + 1;
    end if;
  end loop;

  return query select
    v_generated_count,
    v_existing_count,
    extract(year from p_reference_date)::integer,
    extract(month from p_reference_date)::integer;
end;
$$;

drop function if exists public.admin_list_due_cycles_for_date(date);

create function public.admin_list_due_cycles_for_date(
  p_run_date date default current_date
)
returns table (
  billing_cycle_id uuid,
  tenant_id uuid,
  tenant_name text,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  due_date date,
  amount_cents integer,
  currency text,
  pix_key text,
  pix_beneficiary_name text,
  template_content text,
  notification_type text,
  template_name text,
  attempt_number integer
)
language sql
security definer
set search_path = public
as $$
  select
    cycle.id,
    cycle.tenant_id,
    coalesce(nullif(trim(tenant.public_name), ''), tenant.legal_name),
    customer.id,
    customer.full_name,
    customer.phone_e164,
    cycle.due_date,
    cycle.amount_cents,
    cycle.currency,
    settings.pix_key,
    settings.pix_beneficiary_name,
    template.content,
    case when cycle.due_date = p_run_date then 'due_today' else 'overdue' end,
    case
      when cycle.due_date = p_run_date then 'jack_billing_due_reminder_v2'
      else 'jack_billing_overdue_reminder_v1'
    end,
    coalesce(attempts.attempt_count, 0) + 1
  from public.billing_cycles cycle
  join public.tenants tenant on tenant.id = cycle.tenant_id
  join public.tenant_customers customer on customer.id = cycle.customer_id
  left join public.tenant_billing_settings settings on settings.tenant_id = cycle.tenant_id
  left join public.tenant_message_templates template
    on template.tenant_id = cycle.tenant_id
   and template.template_key = cycle.message_template_key
   and template.channel = 'whatsapp'
   and template.is_active = true
  left join lateral (
    select
      count(*)::integer as attempt_count,
      max(event.created_at) as last_attempt_at,
      (array_agg(event.delivery_status order by event.created_at desc))[1] as last_status,
      bool_or(event.attempt_date = p_run_date) as attempted_today
    from public.billing_reminder_events event
    where event.billing_cycle_id = cycle.id
  ) attempts on true
  where tenant.status = 'active'
    and tenant.plan in ('plan1', 'plan3')
    and customer.is_active = true
    and cycle.status in ('overdue', 'pending')
    and cycle.due_date <= p_run_date
    and cycle.message_sent_at is null
    and coalesce(attempts.attempt_count, 0) < 3
    and not coalesce(attempts.attempted_today, false)
    and (
      attempts.last_status is null
      or attempts.last_status = 'failed'
      or (
        attempts.last_status in ('reserved', 'accepted', 'sent')
        and attempts.last_attempt_at <= now() - interval '24 hours'
      )
    )
  order by cycle.due_date, customer.full_name;
$$;

create or replace function public.admin_reserve_billing_reminder_attempt(
  p_billing_cycle_id uuid,
  p_recipient_e164 text,
  p_rendered_message text,
  p_notification_type text,
  p_template_name text,
  p_attempt_date date default (now() at time zone 'America/Fortaleza')::date
)
returns table (
  reminder_event_id uuid,
  billing_cycle_id uuid,
  attempt_number integer,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.billing_cycles%rowtype;
  v_event public.billing_reminder_events%rowtype;
  v_attempt_count integer := 0;
  v_last_attempt_at timestamptz;
  v_last_status text;
  v_attempted_today boolean := false;
  v_expected_notification_type text;
  v_expected_template_name text;
begin
  if p_attempt_date is null then
    raise exception 'billing_reminder_attempt_date_required';
  end if;
  if p_notification_type is null
     or p_notification_type not in ('due_today', 'overdue') then
    raise exception 'invalid_billing_notification_type';
  end if;
  if nullif(trim(coalesce(p_recipient_e164, '')), '') is null then
    raise exception 'billing_reminder_recipient_required';
  end if;
  if nullif(trim(coalesce(p_template_name, '')), '') is null then
    raise exception 'billing_reminder_template_required';
  end if;

  select cycle.* into v_cycle
  from public.billing_cycles cycle
  where cycle.id = p_billing_cycle_id
  for update;

  if v_cycle.id is null then raise exception 'billing_cycle_not_found'; end if;

  v_expected_notification_type := case
    when v_cycle.due_date = p_attempt_date then 'due_today'
    else 'overdue'
  end;
  v_expected_template_name := case
    when v_cycle.due_date = p_attempt_date then 'jack_billing_due_reminder_v2'
    else 'jack_billing_overdue_reminder_v1'
  end;

  if p_notification_type <> v_expected_notification_type
     or trim(p_template_name) <> v_expected_template_name then
    raise exception 'billing_reminder_template_mismatch';
  end if;

  if v_cycle.message_sent_at is not null
     or v_cycle.status not in ('overdue', 'pending')
     or v_cycle.due_date > p_attempt_date
     or not exists (
       select 1
       from public.tenants tenant
       join public.tenant_customers customer
         on customer.tenant_id = tenant.id
        and customer.id = v_cycle.customer_id
       where tenant.id = v_cycle.tenant_id
         and tenant.status = 'active'
         and tenant.plan in ('plan1', 'plan3')
         and customer.is_active = true
     ) then
    return;
  end if;

  select
    count(*)::integer,
    max(event.created_at),
    (array_agg(event.delivery_status order by event.created_at desc))[1],
    coalesce(bool_or(event.attempt_date = p_attempt_date), false)
  into v_attempt_count, v_last_attempt_at, v_last_status, v_attempted_today
  from public.billing_reminder_events event
  where event.billing_cycle_id = v_cycle.id;

  if v_attempt_count >= 3
     or v_attempted_today
     or not (
       v_last_status is null
       or v_last_status = 'failed'
       or (
         v_last_status in ('reserved', 'accepted', 'sent')
         and v_last_attempt_at <= now() - interval '24 hours'
       )
     ) then
    return;
  end if;

  insert into public.billing_reminder_events (
    billing_cycle_id, tenant_id, customer_id, attempt_number, attempt_date,
    notification_type, template_name, recipient_e164, rendered_message
  ) values (
    v_cycle.id,
    v_cycle.tenant_id,
    v_cycle.customer_id,
    v_attempt_count + 1,
    p_attempt_date,
    p_notification_type,
    trim(p_template_name),
    regexp_replace(p_recipient_e164, '\D', '', 'g'),
    p_rendered_message
  )
  returning * into v_event;

  reminder_event_id := v_event.id;
  billing_cycle_id := v_event.billing_cycle_id;
  attempt_number := v_event.attempt_number;
  delivery_status := v_event.delivery_status;
  return next;
end;
$$;

create or replace function public.admin_record_billing_reminder_accepted(
  p_reminder_event_id uuid,
  p_provider_message_id text,
  p_provider_response jsonb default '{}'::jsonb
)
returns table (
  reminder_event_id uuid,
  billing_cycle_id uuid,
  attempt_number integer,
  delivery_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.billing_reminder_events%rowtype;
  v_conflicting_event_id uuid;
  v_callback record;
begin
  if nullif(trim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'provider_message_id_required';
  end if;

  select event.* into v_event
  from public.billing_reminder_events event
  where event.id = p_reminder_event_id
  for update;

  if v_event.id is null then raise exception 'billing_reminder_reservation_not_found'; end if;

  select event.id into v_conflicting_event_id
  from public.billing_reminder_events event
  where event.provider_message_id = trim(p_provider_message_id)
    and event.id <> v_event.id
  limit 1;

  if v_conflicting_event_id is not null then
    raise exception 'provider_message_id_already_assigned';
  end if;
  if v_event.provider_message_id is not null
     and v_event.provider_message_id <> trim(p_provider_message_id) then
    raise exception 'billing_reminder_provider_message_id_mismatch';
  end if;

  update public.billing_reminder_events event
  set provider_message_id = trim(p_provider_message_id),
      provider_response = coalesce(p_provider_response, '{}'::jsonb),
      delivery_status = case
        when event.delivery_status = 'reserved' then 'accepted'
        else event.delivery_status
      end,
      delivery_status_updated_at = case
        when event.delivery_status = 'reserved' then now()
        else event.delivery_status_updated_at
      end,
      accepted_at = coalesce(event.accepted_at, now()),
      updated_at = now()
  where event.id = v_event.id;

  update public.billing_reminder_delivery_callbacks callback
  set reminder_event_id = v_event.id
  where callback.provider_message_id = trim(p_provider_message_id)
    and callback.reminder_event_id is null;

  for v_callback in
    select callback.*
    from public.billing_reminder_delivery_callbacks callback
    where callback.provider_message_id = trim(p_provider_message_id)
    order by callback.status_updated_at, callback.created_at
  loop
    perform *
    from public.admin_record_billing_reminder_delivery_status(
      v_callback.provider_message_id,
      v_callback.delivery_status,
      v_callback.status_updated_at,
      v_callback.recipient_id,
      v_callback.delivery_error
    );
  end loop;

  select event.* into v_event
  from public.billing_reminder_events event
  where event.id = v_event.id;

  reminder_event_id := v_event.id;
  billing_cycle_id := v_event.billing_cycle_id;
  attempt_number := v_event.attempt_number;
  delivery_status := v_event.delivery_status;
  return next;
end;
$$;

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
  on conflict (provider_message_id, delivery_status, status_updated_at)
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

revoke all on function public.admin_generate_billing_cycles_for_all_tenants(date)
from public, anon, authenticated;
grant execute on function public.admin_generate_billing_cycles_for_all_tenants(date)
to service_role;

revoke all on function public.admin_list_due_cycles_for_date(date)
from public, anon, authenticated;
grant execute on function public.admin_list_due_cycles_for_date(date)
to service_role;

revoke all on function public.admin_reserve_billing_reminder_attempt(
  uuid, text, text, text, text, date
) from public, anon, authenticated;
grant execute on function public.admin_reserve_billing_reminder_attempt(
  uuid, text, text, text, text, date
) to service_role;

revoke all on function public.admin_record_billing_reminder_accepted(
  uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_record_billing_reminder_accepted(
  uuid, text, jsonb
) to service_role;

revoke all on function public.admin_record_billing_reminder_delivery_status(
  text, text, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.admin_record_billing_reminder_delivery_status(
  text, text, timestamptz, text, jsonb
) to service_role;

-- Kept temporarily for a safe workflow rollout. The official workflow stops
-- using this legacy acceptance-as-delivery RPC after migration 050 is applied.
revoke all on function public.admin_mark_cycle_reminder_sent(uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_mark_cycle_reminder_sent(uuid, text)
to service_role;
