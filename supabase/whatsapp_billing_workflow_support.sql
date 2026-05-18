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
  for v_profile in
    select
      cbp.id as billing_profile_id,
      cbp.tenant_id,
      cbp.customer_id,
      cbp.amount_cents,
      cbp.currency,
      cbp.due_day,
      cbp.message_template_key
    from public.customer_billing_profiles cbp
    join public.tenant_customers tc on tc.id = cbp.customer_id
    join public.tenants t on t.id = cbp.tenant_id
    where cbp.status = 'active'
      and tc.is_active = true
      and t.status = 'active'
      and t.plan in ('plan1', 'plan3')
  loop
    v_due_date := make_date(
      extract(year from p_reference_date)::int,
      extract(month from p_reference_date)::int,
      least(
        v_profile.due_day,
        extract(day from (date_trunc('month', p_reference_date) + interval '1 month - 1 day'))::int
      )
    );

    select bc.id
      into v_existing_cycle_id
    from public.billing_cycles bc
    where bc.tenant_id = v_profile.tenant_id
      and bc.customer_id = v_profile.customer_id
      and bc.billing_profile_id = v_profile.billing_profile_id
      and bc.reference_year = extract(year from v_due_date)::int
      and bc.reference_month = extract(month from v_due_date)::int
    limit 1;

    if v_existing_cycle_id is null then
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
        v_profile.tenant_id,
        v_profile.customer_id,
        v_profile.billing_profile_id,
        extract(year from v_due_date)::int,
        extract(month from v_due_date)::int,
        v_due_date,
        v_profile.amount_cents,
        v_profile.currency,
        case when v_due_date <= p_reference_date then 'overdue' else 'pending' end,
        coalesce(v_profile.message_template_key, 'billing_reminder_due_today')
      );

      v_generated_count := v_generated_count + 1;
    else
      v_existing_count := v_existing_count + 1;
    end if;
  end loop;

  return query
  select
    v_generated_count,
    v_existing_count,
    extract(year from p_reference_date)::int,
    extract(month from p_reference_date)::int;
end;
$$;

create or replace function public.admin_list_due_cycles_for_date(
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
  template_content text
)
language sql
security definer
set search_path = public
as $$
  select
    bc.id as billing_cycle_id,
    bc.tenant_id,
    t.legal_name as tenant_name,
    tc.id as customer_id,
    tc.full_name as customer_name,
    tc.phone_e164 as customer_phone,
    bc.due_date,
    bc.amount_cents,
    bc.currency,
    tbs.pix_key,
    tbs.pix_beneficiary_name,
    tmt.content as template_content
  from public.billing_cycles bc
  join public.tenants t on t.id = bc.tenant_id
  join public.tenant_customers tc on tc.id = bc.customer_id
  left join public.tenant_billing_settings tbs on tbs.tenant_id = bc.tenant_id
  left join public.tenant_message_templates tmt
    on tmt.tenant_id = bc.tenant_id
   and tmt.template_key = bc.message_template_key
   and tmt.channel = 'whatsapp'
   and tmt.is_active = true
  where t.status = 'active'
    and t.plan in ('plan1', 'plan3')
    and tc.is_active = true
    and bc.status in ('overdue', 'pending')
    and bc.due_date <= p_run_date
    and bc.message_sent_at is null
  order by bc.due_date asc, tc.full_name asc;
$$;

create or replace function public.admin_mark_cycle_reminder_sent(
  p_billing_cycle_id uuid,
  p_rendered_message text
)
returns table (
  billing_cycle_id uuid,
  message_sent_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.billing_cycles bc
     set message_rendered = p_rendered_message,
         message_sent_at = now(),
         updated_at = now()
   where bc.id = p_billing_cycle_id
     and bc.message_sent_at is null
   returning bc.id, bc.message_sent_at;
end;
$$;

grant execute on function public.admin_generate_billing_cycles_for_all_tenants(date) to authenticated;
grant execute on function public.admin_list_due_cycles_for_date(date) to authenticated;
grant execute on function public.admin_mark_cycle_reminder_sent(uuid, text) to authenticated;
