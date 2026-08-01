-- Idempotent reconciliation for recurring payments received by the platform.

create table if not exists public.platform_payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mercado_pago',
  provider_event_id text not null,
  event_type text not null,
  resource_type text not null,
  provider_resource_id text not null,
  provider_subscription_row_id uuid references public.platform_payment_provider_subscriptions(id) on delete set null,
  processing_status text not null default 'received',
  processing_attempts integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint platform_payment_provider_events_provider_chk
    check (provider = 'mercado_pago'),
  constraint platform_payment_provider_events_resource_chk
    check (resource_type in ('subscription', 'authorized_payment', 'payment')),
  constraint platform_payment_provider_events_processing_chk
    check (processing_status in ('received', 'processed', 'failed')),
  constraint platform_payment_provider_events_attempts_chk
    check (processing_attempts >= 0),
  constraint platform_payment_provider_events_provider_id_uq
    unique (provider, provider_event_id)
);

create index if not exists platform_payment_provider_events_processing_idx
on public.platform_payment_provider_events (processing_status, received_at);

create index if not exists platform_payment_provider_events_subscription_idx
on public.platform_payment_provider_events (provider_subscription_row_id, received_at desc);

alter table public.platform_payment_provider_events enable row level security;

revoke all on table public.platform_payment_provider_events
from public, anon, authenticated;

grant select, insert, update, delete on table public.platform_payment_provider_events
to service_role;

alter table public.payments
add column if not exists platform_provider_subscription_id uuid
  references public.platform_payment_provider_subscriptions(id) on delete set null,
add column if not exists provider_invoice_id text,
add column if not exists provider_payment_id text,
add column if not exists provider_status text,
add column if not exists provider_status_detail text,
add column if not exists fee_cents integer,
add column if not exists net_amount_cents integer,
add column if not exists paid_at timestamptz,
add column if not exists refunded_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

alter table public.payments
drop constraint if exists payments_status_check;

alter table public.payments
add constraint payments_status_check
check (status in (
  'pending', 'paid', 'deleted', 'cancelled', 'failed', 'refunded', 'chargeback'
));

create unique index if not exists payments_provider_invoice_uq
on public.payments (provider, provider_invoice_id)
where provider_invoice_id is not null;

create unique index if not exists payments_provider_payment_uq
on public.payments (provider, provider_payment_id)
where provider_payment_id is not null;

create index if not exists payments_platform_provider_subscription_idx
on public.payments (platform_provider_subscription_id, created_at desc);

alter table public.platform_payment_events
add column if not exists provider text,
add column if not exists provider_event_id text,
add column if not exists provider_invoice_id text,
add column if not exists provider_payment_id text,
add column if not exists fee_cents integer,
add column if not exists net_amount_cents integer;

create unique index if not exists platform_payment_events_provider_event_uq
on public.platform_payment_events (provider, provider_event_id)
where provider is not null and provider_event_id is not null;

create or replace function public.admin_reconcile_platform_mercado_pago_payment(
  p_subscription_row_id uuid,
  p_provider_event_row_id uuid,
  p_provider_invoice_id text,
  p_provider_payment_id text,
  p_provider_status text,
  p_provider_status_detail text,
  p_amount_cents integer,
  p_currency text,
  p_due_at timestamptz,
  p_fee_cents integer,
  p_net_amount_cents integer,
  p_paid_at timestamptz,
  p_refunded_at timestamptz,
  p_provider_payload jsonb
)
returns table (
  payment_id uuid,
  payment_status text,
  duplicate boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.platform_payment_provider_subscriptions%rowtype;
  v_provider_event public.platform_payment_provider_events%rowtype;
  v_payment public.payments%rowtype;
  v_old_status text;
  v_target_status text;
  v_due_date date;
  v_now timestamptz := now();
  v_duplicate boolean := false;
begin
  if nullif(trim(coalesce(p_provider_payment_id, '')), '') is null
     and nullif(trim(coalesce(p_provider_invoice_id, '')), '') is null then
    raise exception 'provider_payment_or_invoice_required';
  end if;

  select * into v_subscription
  from public.platform_payment_provider_subscriptions subscription_row
  where subscription_row.id = p_subscription_row_id
    and subscription_row.provider = 'mercado_pago'
  for update;

  if v_subscription.id is null then
    raise exception 'platform_provider_subscription_not_found';
  end if;

  select * into v_provider_event
  from public.platform_payment_provider_events provider_event
  where provider_event.id = p_provider_event_row_id
    and provider_event.provider = 'mercado_pago'
  for update;

  if v_provider_event.id is null then
    raise exception 'platform_provider_event_not_found';
  end if;

  if v_provider_event.provider_subscription_row_id is not null
     and v_provider_event.provider_subscription_row_id <> v_subscription.id then
    raise exception 'platform_provider_event_subscription_mismatch';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0
     or p_amount_cents <> v_subscription.amount_cents
     or p_currency is distinct from v_subscription.currency
     or p_currency <> 'BRL' then
    raise exception 'platform_subscription_amount_mismatch';
  end if;

  v_target_status := case lower(trim(coalesce(p_provider_status, '')))
    when 'approved' then 'paid'
    when 'pending' then 'pending'
    when 'in_process' then 'pending'
    when 'authorized' then 'pending'
    when 'scheduled' then 'pending'
    when 'rejected' then 'failed'
    when 'cancelled' then 'cancelled'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'chargeback'
    else null
  end;

  if v_target_status is null then
    raise exception 'unsupported_platform_payment_status';
  end if;

  v_due_date := coalesce(
    (p_due_at at time zone 'America/Fortaleza')::date,
    (v_now at time zone 'America/Fortaleza')::date
  );

  if v_provider_event.processing_status = 'processed' then
    select * into v_payment
    from public.payments payment_row
    where payment_row.provider = 'mercado_pago'
      and (
        (nullif(trim(coalesce(p_provider_payment_id, '')), '') is not null
          and payment_row.provider_payment_id = p_provider_payment_id)
        or
        (nullif(trim(coalesce(p_provider_invoice_id, '')), '') is not null
          and payment_row.provider_invoice_id = p_provider_invoice_id)
      )
    order by payment_row.created_at desc
    limit 1;

    if v_payment.id is null then
      raise exception 'processed_platform_payment_not_found';
    end if;

    return query select v_payment.id, v_payment.status, true;
    return;
  end if;

  if nullif(trim(coalesce(p_provider_payment_id, '')), '') is not null then
    select * into v_payment
    from public.payments payment_row
    where payment_row.provider = 'mercado_pago'
      and payment_row.provider_payment_id = p_provider_payment_id
    for update;
  end if;

  if v_payment.id is null
     and nullif(trim(coalesce(p_provider_invoice_id, '')), '') is not null then
    select * into v_payment
    from public.payments payment_row
    where payment_row.provider = 'mercado_pago'
      and payment_row.provider_invoice_id = p_provider_invoice_id
    for update;
  end if;

  if v_payment.id is null
     and nullif(trim(coalesce(p_provider_payment_id, '')), '') is not null then
    select * into v_payment
    from public.payments payment_row
    where payment_row.provider = 'mercado_pago'
      and payment_row.platform_provider_subscription_id = v_subscription.id
      and payment_row.amount_cents = p_amount_cents
      and payment_row.provider_payment_id is null
      and payment_row.payload->>'due_date' = v_due_date::text
    order by payment_row.created_at
    limit 1
    for update skip locked;
  end if;

  if v_payment.id is null then
    select * into v_payment
    from public.payments payment_row
    where payment_row.tenant_id = v_subscription.tenant_id
      and payment_row.subscription_id is not distinct from v_subscription.subscription_id
      and payment_row.amount_cents = p_amount_cents
      and payment_row.billing_type = 'platform_subscription'
      and payment_row.status = 'pending'
      and payment_row.deleted_at is null
      and payment_row.provider_payment_id is null
      and payment_row.provider_invoice_id is null
    order by payment_row.created_at
    limit 1
    for update skip locked;
  end if;

  if v_payment.id is null then
    insert into public.payments (
      tenant_id,
      subscription_id,
      platform_provider_subscription_id,
      provider,
      provider_invoice_id,
      provider_payment_id,
      provider_status,
      provider_status_detail,
      amount_cents,
      billing_type,
      status,
      payload,
      confirmed_at,
      confirmed_source,
      confirmed_note,
      fee_cents,
      net_amount_cents,
      paid_at,
      refunded_at,
      created_at,
      updated_at
    ) values (
      v_subscription.tenant_id,
      v_subscription.subscription_id,
      v_subscription.id,
      'mercado_pago',
      nullif(trim(coalesce(p_provider_invoice_id, '')), ''),
      nullif(trim(coalesce(p_provider_payment_id, '')), ''),
      p_provider_status,
      p_provider_status_detail,
      p_amount_cents,
      'platform_subscription',
      v_target_status,
      jsonb_strip_nulls(jsonb_build_object(
        'source', 'mercado_pago_subscription',
        'due_date', v_due_date,
        'billing_profile_id', v_subscription.billing_profile_id,
        'provider_invoice_id', nullif(trim(coalesce(p_provider_invoice_id, '')), ''),
        'provider_payload', coalesce(p_provider_payload, '{}'::jsonb)
      )),
      case when v_target_status = 'paid' then coalesce(p_paid_at, v_now) else null end,
      case when v_target_status = 'paid' then 'mercado_pago' else null end,
      case when v_target_status = 'paid' then 'Confirmado automaticamente pelo Mercado Pago.' else null end,
      p_fee_cents,
      p_net_amount_cents,
      case when v_target_status = 'paid' then coalesce(p_paid_at, v_now) else p_paid_at end,
      case when v_target_status = 'refunded' then coalesce(p_refunded_at, v_now) else p_refunded_at end,
      coalesce(p_due_at, v_now),
      v_now
    ) returning * into v_payment;

    v_old_status := null;
  else
    v_old_status := v_payment.status;

    if v_old_status = 'chargeback' then
      v_target_status := 'chargeback';
    elsif v_old_status = 'refunded' and v_target_status <> 'chargeback' then
      v_target_status := 'refunded';
    elsif v_old_status = 'paid' and v_target_status in ('pending', 'failed', 'cancelled') then
      v_target_status := 'paid';
    end if;

    update public.payments payment_row
    set
      platform_provider_subscription_id = v_subscription.id,
      provider = 'mercado_pago',
      provider_invoice_id = coalesce(
        nullif(trim(coalesce(p_provider_invoice_id, '')), ''),
        payment_row.provider_invoice_id
      ),
      provider_payment_id = coalesce(
        nullif(trim(coalesce(p_provider_payment_id, '')), ''),
        payment_row.provider_payment_id
      ),
      provider_status = p_provider_status,
      provider_status_detail = p_provider_status_detail,
      status = v_target_status,
      payload = coalesce(payment_row.payload, '{}'::jsonb) ||
        jsonb_strip_nulls(jsonb_build_object(
          'source', 'mercado_pago_subscription',
          'due_date', v_due_date,
          'billing_profile_id', v_subscription.billing_profile_id,
          'provider_invoice_id', nullif(trim(coalesce(p_provider_invoice_id, '')), ''),
          'provider_payload', coalesce(p_provider_payload, '{}'::jsonb)
        )),
      confirmed_at = case
        when v_target_status = 'paid' then coalesce(payment_row.confirmed_at, p_paid_at, v_now)
        else payment_row.confirmed_at
      end,
      confirmed_source = case
        when v_target_status = 'paid' then 'mercado_pago'
        else payment_row.confirmed_source
      end,
      confirmed_note = case
        when v_target_status = 'paid' then 'Confirmado automaticamente pelo Mercado Pago.'
        else payment_row.confirmed_note
      end,
      fee_cents = coalesce(p_fee_cents, payment_row.fee_cents),
      net_amount_cents = coalesce(p_net_amount_cents, payment_row.net_amount_cents),
      paid_at = case
        when v_target_status = 'paid' then coalesce(payment_row.paid_at, p_paid_at, v_now)
        else payment_row.paid_at
      end,
      refunded_at = case
        when v_target_status = 'refunded' then coalesce(payment_row.refunded_at, p_refunded_at, v_now)
        else payment_row.refunded_at
      end,
      updated_at = v_now
    where payment_row.id = v_payment.id
    returning * into v_payment;
  end if;

  insert into public.platform_payment_events (
    payment_id,
    billing_profile_id,
    tenant_id,
    event_type,
    old_status,
    new_status,
    source,
    note,
    provider,
    provider_event_id,
    provider_invoice_id,
    provider_payment_id,
    fee_cents,
    net_amount_cents
  ) values (
    v_payment.id,
    v_subscription.billing_profile_id,
    v_subscription.tenant_id,
    'payment_status',
    v_old_status,
    v_payment.status,
    'mercado_pago',
    'Pagamento recorrente conciliado automaticamente.',
    'mercado_pago',
    v_provider_event.provider_event_id,
    nullif(trim(coalesce(p_provider_invoice_id, '')), ''),
    nullif(trim(coalesce(p_provider_payment_id, '')), ''),
    p_fee_cents,
    p_net_amount_cents
  )
  on conflict (provider, provider_event_id)
  where provider is not null and provider_event_id is not null
  do nothing;

  update public.platform_payment_provider_events provider_event
  set
    provider_subscription_row_id = v_subscription.id,
    processing_status = 'processed',
    processing_attempts = provider_event.processing_attempts + 1,
    error_code = null,
    error_message = null,
    processed_at = v_now
  where provider_event.id = v_provider_event.id;

  return query select v_payment.id, v_payment.status, v_duplicate;
end;
$$;

revoke all on function public.admin_reconcile_platform_mercado_pago_payment(
  uuid, uuid, text, text, text, text, integer, text, timestamptz,
  integer, integer, timestamptz, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.admin_reconcile_platform_mercado_pago_payment(
  uuid, uuid, text, text, text, text, integer, text, timestamptz,
  integer, integer, timestamptz, timestamptz, jsonb
) to service_role;
