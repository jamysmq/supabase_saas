create or replace function public.admin_create_initial_customer_billing_cycle(
  p_tenant_id uuid,
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.customer_billing_profiles%rowtype;
  v_cycle_id uuid;
  v_due_date date;
begin
  select *
    into v_profile
  from public.customer_billing_profiles cbp
  where cbp.tenant_id = p_tenant_id
    and cbp.customer_id = p_customer_id
    and cbp.status = 'active'
  order by cbp.created_at desc
  limit 1;

  if v_profile.id is null then
    raise exception 'active_billing_profile_not_found';
  end if;

  v_due_date := make_date(
    extract(year from current_date)::int,
    extract(month from current_date)::int,
    least(v_profile.due_day, extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int)
  );

  select bc.id
    into v_cycle_id
  from public.billing_cycles bc
  where bc.tenant_id = p_tenant_id
    and bc.customer_id = p_customer_id
    and bc.billing_profile_id = v_profile.id
    and bc.reference_year = extract(year from v_due_date)::int
    and bc.reference_month = extract(month from v_due_date)::int
  limit 1;

  if v_cycle_id is not null then
    return v_cycle_id;
  end if;

  insert into public.billing_cycles (
    tenant_id,
    customer_id,
    billing_profile_id,
    reference_year,
    reference_month,
    due_date,
    amount_cents,
    currency,
    status,
    message_template_key
  )
  values (
    p_tenant_id,
    p_customer_id,
    v_profile.id,
    extract(year from v_due_date)::int,
    extract(month from v_due_date)::int,
    v_due_date,
    v_profile.amount_cents,
    v_profile.currency,
    'overdue',
    coalesce(v_profile.message_template_key, 'billing_reminder_due_today')
  )
  returning id into v_cycle_id;

  return v_cycle_id;
end;
$$;

grant execute on function public.admin_create_initial_customer_billing_cycle(uuid, uuid) to authenticated;
