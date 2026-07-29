-- Mercado Pago dynamic Pix, webhook reconciliation and auditable automatic settlement.

alter table public.billing_cycles
drop constraint if exists billing_cycles_status_chk;

alter table public.billing_cycles
add constraint billing_cycles_status_chk
check (status in (
  'pending',
  'overdue',
  'paid_manual',
  'paid_asaas',
  'paid_mercado_pago',
  'refunded',
  'chargeback',
  'canceled'
));

alter table public.tenant_payment_provider_charges
  add column if not exists attempt_number integer not null default 1,
  add column if not exists idempotency_key uuid,
  add column if not exists provider_status text,
  add column if not exists provider_status_detail text,
  add column if not exists reconciliation_status text not null default 'pending',
  add column if not exists divergence_reason text,
  add column if not exists last_reconciled_at timestamptz;

alter table public.tenant_payment_provider_charges
drop constraint if exists tenant_payment_provider_charges_attempt_chk;

alter table public.tenant_payment_provider_charges
add constraint tenant_payment_provider_charges_attempt_chk
check (attempt_number > 0);

alter table public.tenant_payment_provider_charges
drop constraint if exists tenant_payment_provider_charges_reconciliation_chk;

alter table public.tenant_payment_provider_charges
add constraint tenant_payment_provider_charges_reconciliation_chk
check (reconciliation_status in ('pending', 'matched', 'divergent', 'ignored'));

create unique index if not exists tenant_payment_provider_charges_idempotency_uq
on public.tenant_payment_provider_charges(connection_id, idempotency_key)
where idempotency_key is not null;

create unique index if not exists tenant_payment_provider_charges_cycle_attempt_uq
on public.tenant_payment_provider_charges(
  tenant_id,
  billing_cycle_id,
  payment_method,
  attempt_number
)
where billing_cycle_id is not null;

create index if not exists tenant_payment_provider_charges_reconciliation_idx
on public.tenant_payment_provider_charges(
  tenant_id,
  reconciliation_status,
  updated_at desc
);

alter table public.tenant_payment_events
  add column if not exists provider text,
  add column if not exists provider_charge_id text,
  add column if not exists provider_event_id text;

create unique index if not exists tenant_payment_events_provider_event_uq
on public.tenant_payment_events(provider, provider_event_id)
where provider is not null and provider_event_id is not null;

create or replace function public.admin_reconcile_mercado_pago_payment(
  p_charge_id uuid,
  p_provider_status text,
  p_status_detail text,
  p_amount_cents integer,
  p_fee_cents integer,
  p_net_amount_cents integer,
  p_paid_at timestamptz,
  p_provider_payload jsonb,
  p_event_id uuid default null
)
returns table (
  charge_id uuid,
  billing_cycle_id uuid,
  charge_status text,
  cycle_status text,
  reconciliation_status text,
  divergence_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charge public.tenant_payment_provider_charges%rowtype;
  v_cycle public.billing_cycles%rowtype;
  v_local_status text;
  v_reconciliation_status text := 'matched';
  v_divergence_reason text;
  v_target_cycle_status text;
  v_old_cycle_status text;
  v_provider_event_id text;
  v_now timestamptz := now();
begin
  select *
  into v_charge
  from public.tenant_payment_provider_charges charge
  where charge.id = p_charge_id
    and charge.provider = 'mercado_pago'
  for update;

  if v_charge.id is null then
    raise exception 'Cobrança do Mercado Pago não encontrada';
  end if;

  select *
  into v_cycle
  from public.billing_cycles cycle
  where cycle.id = v_charge.billing_cycle_id
    and cycle.tenant_id = v_charge.tenant_id
    and cycle.customer_id = v_charge.customer_id
  for update;

  if v_cycle.id is null then
    raise exception 'Ciclo financeiro vinculado não encontrado';
  end if;

  v_old_cycle_status := v_cycle.status;

  if p_event_id is not null then
    select provider_event.provider_event_id
    into v_provider_event_id
    from public.tenant_payment_provider_events provider_event
    where provider_event.id = p_event_id
      and provider_event.tenant_id = v_charge.tenant_id
      and provider_event.connection_id = v_charge.connection_id
      and provider_event.provider = 'mercado_pago'
    for update;

    if v_provider_event_id is null then
      raise exception 'Evento do Mercado Pago não pertence à cobrança';
    end if;
  end if;

  v_local_status := case
    when p_provider_status = 'approved' then 'paid'
    when p_provider_status in ('pending', 'in_process', 'in_mediation', 'authorized') then 'pending'
    when p_provider_status = 'rejected' then 'failed'
    when p_provider_status = 'cancelled' then 'cancelled'
    when p_provider_status = 'refunded' then 'refunded'
    when p_provider_status = 'charged_back' then 'chargeback'
    when p_provider_status = 'expired' then 'expired'
    else 'pending'
  end;

  if p_amount_cents is null or p_amount_cents <> v_charge.amount_cents
    or p_amount_cents <> v_cycle.amount_cents then
    v_reconciliation_status := 'divergent';
    v_divergence_reason := 'amount_mismatch';
  elsif v_local_status = 'paid'
    and v_cycle.status not in ('pending', 'overdue', 'paid_mercado_pago') then
    v_reconciliation_status := 'divergent';
    v_divergence_reason := 'cycle_already_settled';
  elsif v_local_status in ('refunded', 'chargeback')
    and v_cycle.status not in ('paid_mercado_pago', v_local_status) then
    v_reconciliation_status := 'divergent';
    v_divergence_reason := 'cycle_status_mismatch';
  elsif p_provider_status not in (
    'approved',
    'pending',
    'in_process',
    'in_mediation',
    'authorized',
    'rejected',
    'cancelled',
    'refunded',
    'charged_back',
    'expired'
  ) then
    v_reconciliation_status := 'divergent';
    v_divergence_reason := 'unknown_provider_status';
  end if;

  update public.tenant_payment_provider_charges charge
  set
    status = v_local_status,
    provider_status = p_provider_status,
    provider_status_detail = nullif(p_status_detail, ''),
    fee_cents = p_fee_cents,
    net_amount_cents = p_net_amount_cents,
    paid_at = case
      when v_local_status = 'paid' then coalesce(p_paid_at, charge.paid_at, v_now)
      else charge.paid_at
    end,
    failed_at = case
      when v_local_status in ('failed', 'expired', 'cancelled') then
        coalesce(charge.failed_at, v_now)
      else charge.failed_at
    end,
    refunded_at = case
      when v_local_status in ('refunded', 'chargeback') then
        coalesce(charge.refunded_at, v_now)
      else charge.refunded_at
    end,
    provider_payload = coalesce(p_provider_payload, '{}'::jsonb),
    reconciliation_status = v_reconciliation_status,
    divergence_reason = v_divergence_reason,
    last_reconciled_at = v_now,
    updated_at = v_now
  where charge.id = v_charge.id
  returning * into v_charge;

  if v_reconciliation_status = 'matched' and v_local_status = 'paid'
    and v_cycle.status in ('pending', 'overdue') then
    v_target_cycle_status := 'paid_mercado_pago';

    update public.billing_cycles cycle
    set
      status = v_target_cycle_status,
      paid_at = coalesce(p_paid_at, v_now),
      payment_note = 'Confirmado automaticamente pelo Mercado Pago',
      updated_at = v_now
    where cycle.id = v_cycle.id
    returning * into v_cycle;
  elsif v_reconciliation_status = 'matched'
    and v_local_status in ('refunded', 'chargeback')
    and v_cycle.status = 'paid_mercado_pago' then
    v_target_cycle_status := v_local_status;

    update public.billing_cycles cycle
    set
      status = v_target_cycle_status,
      payment_note = case
        when v_local_status = 'refunded' then 'Pagamento estornado pelo Mercado Pago'
        else 'Pagamento em chargeback no Mercado Pago'
      end,
      updated_at = v_now
    where cycle.id = v_cycle.id
    returning * into v_cycle;
  end if;

  if v_target_cycle_status is not null then
    insert into public.tenant_payment_events (
      tenant_id,
      billing_cycle_id,
      billing_profile_id,
      customer_id,
      event_type,
      old_status,
      new_status,
      source,
      note,
      provider,
      provider_charge_id,
      provider_event_id
    ) values (
      v_cycle.tenant_id,
      v_cycle.id,
      v_cycle.billing_profile_id,
      v_cycle.customer_id,
      'payment_status',
      v_old_cycle_status,
      v_target_cycle_status,
      'mercado_pago',
      v_cycle.payment_note,
      'mercado_pago',
      v_charge.provider_charge_id,
      v_provider_event_id
    )
    on conflict (provider, provider_event_id)
    where provider is not null and provider_event_id is not null
    do nothing;
  end if;

  if p_event_id is not null then
    update public.tenant_payment_provider_events provider_event
    set
      charge_id = v_charge.id,
      processing_status = 'processed',
      processing_attempts = provider_event.processing_attempts + 1,
      error_code = v_divergence_reason,
      error_message = case
        when v_divergence_reason is null then null
        else 'Pagamento mantido para revisão manual'
      end,
      processed_at = v_now
    where provider_event.id = p_event_id
      and provider_event.tenant_id = v_charge.tenant_id
      and provider_event.connection_id = v_charge.connection_id
      and provider_event.provider = 'mercado_pago';
  end if;

  return query
  select
    v_charge.id,
    v_cycle.id,
    v_charge.status,
    v_cycle.status,
    v_charge.reconciliation_status,
    v_charge.divergence_reason;
end;
$$;

revoke all on function public.admin_reconcile_mercado_pago_payment(
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  timestamptz,
  jsonb,
  uuid
) from public, anon, authenticated;

grant execute on function public.admin_reconcile_mercado_pago_payment(
  uuid,
  text,
  text,
  integer,
  integer,
  integer,
  timestamptz,
  jsonb,
  uuid
) to service_role;
