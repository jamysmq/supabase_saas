begin;

do $$
declare
  v_connection public.tenant_payment_provider_connections%rowtype;
  v_cycle public.billing_cycles%rowtype;
  v_charge_id uuid;
  v_event_id uuid;
  v_ref text := 'rollback-advanced-' || gen_random_uuid()::text;
  v_result record;
  v_audit_count integer;
begin
  select connection.*
  into v_connection
  from public.tenant_payment_provider_connections connection
  where connection.provider = 'mercado_pago'
    and connection.status = 'connected'
  order by connection.created_at
  limit 1;

  if v_connection.id is null then
    raise exception 'Nenhuma conexão ativa do Mercado Pago encontrada';
  end if;

  select cycle.*
  into v_cycle
  from public.billing_cycles cycle
  where cycle.tenant_id = v_connection.tenant_id
    and cycle.status in ('pending', 'overdue')
  order by cycle.due_date, cycle.created_at
  limit 1
  for update;

  if v_cycle.id is null then
    raise exception 'Nenhum ciclo pendente ou vencido disponível para o teste';
  end if;

  -- Aprovação, repetição idempotente, estorno e replay de evento antigo.
  insert into public.tenant_payment_provider_charges (
    tenant_id,
    connection_id,
    billing_cycle_id,
    customer_id,
    provider,
    provider_charge_id,
    external_reference,
    payment_method,
    status,
    amount_cents,
    due_date,
    attempt_number,
    idempotency_key
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_cycle.id,
    v_cycle.customer_id,
    'mercado_pago',
    v_ref || '-charge-1',
    v_ref || '-external-1',
    'pix',
    'pending',
    v_cycle.amount_cents,
    v_cycle.due_date,
    900001,
    gen_random_uuid()
  )
  returning id into v_charge_id;

  insert into public.tenant_payment_provider_events (
    tenant_id,
    connection_id,
    charge_id,
    provider,
    provider_event_id,
    event_type,
    resource_type,
    provider_resource_id,
    payload
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_charge_id,
    'mercado_pago',
    v_ref || '-approved',
    'payment.updated',
    'payment',
    v_ref || '-charge-1',
    jsonb_build_object('test', 'rollback', 'status', 'approved')
  )
  returning id into v_event_id;

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback'),
    v_event_id
  );

  if v_result.charge_status <> 'paid'
    or v_result.cycle_status <> 'paid_mercado_pago'
    or v_result.reconciliation_status <> 'matched' then
    raise exception 'Falha na conciliação aprovada: %', row_to_json(v_result);
  end if;

  perform *
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback', 'duplicate', true),
    v_event_id
  );

  select count(*)
  into v_audit_count
  from public.tenant_payment_events audit
  where audit.provider = 'mercado_pago'
    and audit.provider_event_id = v_ref || '-approved';

  if v_audit_count <> 1 then
    raise exception 'Evento duplicado gerou % registros de auditoria', v_audit_count;
  end if;

  insert into public.tenant_payment_provider_events (
    tenant_id,
    connection_id,
    charge_id,
    provider,
    provider_event_id,
    event_type,
    resource_type,
    provider_resource_id,
    payload
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_charge_id,
    'mercado_pago',
    v_ref || '-refunded',
    'payment.updated',
    'payment',
    v_ref || '-charge-1',
    jsonb_build_object('test', 'rollback', 'status', 'refunded')
  )
  returning id into v_event_id;

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'refunded',
    'refunded',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback'),
    v_event_id
  );

  if v_result.cycle_status <> 'refunded'
    or v_result.reconciliation_status <> 'matched' then
    raise exception 'Falha no estorno conciliado: %', row_to_json(v_result);
  end if;

  select id
  into v_event_id
  from public.tenant_payment_provider_events
  where provider = 'mercado_pago'
    and provider_event_id = v_ref || '-approved';

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback', 'out_of_order', true),
    v_event_id
  );

  if v_result.cycle_status <> 'refunded'
    or v_result.reconciliation_status <> 'divergent'
    or v_result.divergence_reason <> 'cycle_already_settled' then
    raise exception 'Replay antigo não foi isolado: %', row_to_json(v_result);
  end if;

  update public.billing_cycles
  set
    status = v_cycle.status,
    paid_at = v_cycle.paid_at,
    payment_note = v_cycle.payment_note
  where id = v_cycle.id;

  -- Divergência de valor seguida pela confirmação com o valor correto.
  insert into public.tenant_payment_provider_charges (
    tenant_id,
    connection_id,
    billing_cycle_id,
    customer_id,
    provider,
    provider_charge_id,
    external_reference,
    payment_method,
    status,
    amount_cents,
    due_date,
    attempt_number,
    idempotency_key
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_cycle.id,
    v_cycle.customer_id,
    'mercado_pago',
    v_ref || '-charge-2',
    v_ref || '-external-2',
    'pix',
    'pending',
    v_cycle.amount_cents,
    v_cycle.due_date,
    900002,
    gen_random_uuid()
  )
  returning id into v_charge_id;

  insert into public.tenant_payment_provider_events (
    tenant_id,
    connection_id,
    charge_id,
    provider,
    provider_event_id,
    event_type,
    resource_type,
    provider_resource_id,
    payload
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_charge_id,
    'mercado_pago',
    v_ref || '-amount-mismatch',
    'payment.updated',
    'payment',
    v_ref || '-charge-2',
    jsonb_build_object('test', 'rollback', 'amount_mismatch', true)
  )
  returning id into v_event_id;

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents + 1,
    0,
    v_cycle.amount_cents + 1,
    now(),
    jsonb_build_object('test', 'rollback'),
    v_event_id
  );

  if v_result.cycle_status <> v_cycle.status
    or v_result.reconciliation_status <> 'divergent'
    or v_result.divergence_reason <> 'amount_mismatch' then
    raise exception 'Divergência de valor não foi isolada: %', row_to_json(v_result);
  end if;

  insert into public.tenant_payment_provider_events (
    tenant_id,
    connection_id,
    charge_id,
    provider,
    provider_event_id,
    event_type,
    resource_type,
    provider_resource_id,
    payload
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_charge_id,
    'mercado_pago',
    v_ref || '-amount-corrected',
    'payment.updated',
    'payment',
    v_ref || '-charge-2',
    jsonb_build_object('test', 'rollback', 'amount_corrected', true)
  )
  returning id into v_event_id;

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback'),
    v_event_id
  );

  if v_result.cycle_status <> 'paid_mercado_pago'
    or v_result.reconciliation_status <> 'matched' then
    raise exception 'Correção de valor não conciliou: %', row_to_json(v_result);
  end if;

  update public.billing_cycles
  set
    status = 'paid_manual',
    paid_at = now(),
    payment_note = 'Teste transitório com rollback'
  where id = v_cycle.id;

  -- Uma baixa manual existente nunca pode ser sobrescrita pela automação.
  insert into public.tenant_payment_provider_charges (
    tenant_id,
    connection_id,
    billing_cycle_id,
    customer_id,
    provider,
    provider_charge_id,
    external_reference,
    payment_method,
    status,
    amount_cents,
    due_date,
    attempt_number,
    idempotency_key
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_cycle.id,
    v_cycle.customer_id,
    'mercado_pago',
    v_ref || '-charge-3',
    v_ref || '-external-3',
    'pix',
    'pending',
    v_cycle.amount_cents,
    v_cycle.due_date,
    900003,
    gen_random_uuid()
  )
  returning id into v_charge_id;

  insert into public.tenant_payment_provider_events (
    tenant_id,
    connection_id,
    charge_id,
    provider,
    provider_event_id,
    event_type,
    resource_type,
    provider_resource_id,
    payload
  ) values (
    v_cycle.tenant_id,
    v_connection.id,
    v_charge_id,
    'mercado_pago',
    v_ref || '-manual-collision',
    'payment.updated',
    'payment',
    v_ref || '-charge-3',
    jsonb_build_object('test', 'rollback', 'manual_collision', true)
  )
  returning id into v_event_id;

  select *
  into v_result
  from public.admin_reconcile_mercado_pago_payment(
    v_charge_id,
    'approved',
    'accredited',
    v_cycle.amount_cents,
    0,
    v_cycle.amount_cents,
    now(),
    jsonb_build_object('test', 'rollback'),
    v_event_id
  );

  if v_result.cycle_status <> 'paid_manual'
    or v_result.reconciliation_status <> 'divergent'
    or v_result.divergence_reason <> 'cycle_already_settled' then
    raise exception 'Baixa manual foi sobrescrita ou não sinalizada: %', row_to_json(v_result);
  end if;

  raise notice 'OK: duplicidade, ordem de eventos, divergência de valor e baixa manual validadas';
end;
$$;

rollback;
