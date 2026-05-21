-- Migration: 002_billing_and_payment_history.sql
-- Generated from existing loose SQL files. Keep source files until this is tested in staging.
-- Source files:
-- - supabase/initial_pending_payments.sql
-- - supabase/platform_payment_history.sql
-- - supabase/tenant_payment_history.sql
-- - supabase/whatsapp_billing_workflow_support.sql


-- ============================================================
-- Source: supabase/initial_pending_payments.sql
-- ============================================================

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


-- ============================================================
-- Source: supabase/platform_payment_history.sql
-- ============================================================

alter table public.payments
add column if not exists deleted_at timestamptz,
add column if not exists confirmed_source text,
add column if not exists confirmed_note text;

alter table public.payments
drop constraint if exists payments_status_check;

alter table public.payments
add constraint payments_status_check
check (status in ('pending', 'paid', 'deleted', 'cancelled', 'failed'));

create table if not exists public.platform_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references public.payments(id) on delete set null,
  billing_profile_id uuid references public.platform_tenant_billing_profiles(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  platform_admin_auth_user_id uuid,
  event_type text not null default 'payment_status',
  old_status text,
  new_status text not null,
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now()
);

alter table public.platform_payment_events
add column if not exists billing_profile_id uuid references public.platform_tenant_billing_profiles(id) on delete set null,
add column if not exists event_type text not null default 'payment_status',
add column if not exists tenant_legal_name_snapshot text,
add column if not exists tenant_email_snapshot text,
add column if not exists tenant_cpf_snapshot text,
add column if not exists tenant_whatsapp_snapshot text,
add column if not exists tenant_business_type_snapshot text,
add column if not exists tenant_plan_snapshot text;

create index if not exists platform_payment_events_billing_profile_created_idx
on public.platform_payment_events (billing_profile_id, created_at desc);

create index if not exists platform_payment_events_payment_created_idx
on public.platform_payment_events (payment_id, created_at desc);

create index if not exists platform_payment_events_tenant_created_idx
on public.platform_payment_events (tenant_id, created_at desc);

alter table public.platform_payment_events enable row level security;

grant select, insert, update, delete
on public.platform_payment_events
to service_role;

drop policy if exists "platform_payment_events_no_client_access" on public.platform_payment_events;
create policy "platform_payment_events_no_client_access"
on public.platform_payment_events
for select
to authenticated
using (false);


-- ============================================================
-- Source: supabase/tenant_payment_history.sql
-- ============================================================

create table if not exists public.tenant_payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  billing_profile_id uuid references public.customer_billing_profiles(id) on delete set null,
  customer_id uuid references public.tenant_customers(id) on delete set null,
  tenant_user_id uuid references public.tenant_users(id) on delete set null,
  event_type text not null default 'payment_status',
  old_status text,
  new_status text not null,
  source text not null default 'manual',
  note text,
  created_at timestamptz not null default now()
);

create index if not exists tenant_payment_events_tenant_created_idx
on public.tenant_payment_events (tenant_id, created_at desc);

create index if not exists tenant_payment_events_billing_cycle_created_idx
on public.tenant_payment_events (billing_cycle_id, created_at desc);

create index if not exists tenant_payment_events_billing_profile_created_idx
on public.tenant_payment_events (billing_profile_id, created_at desc);

alter table public.tenant_payment_events enable row level security;

grant select
on public.tenant_payment_events
to authenticated;

grant select, insert, update, delete
on public.tenant_payment_events
to service_role;

drop policy if exists "tenant_payment_events_read_own_tenant" on public.tenant_payment_events;
create policy "tenant_payment_events_read_own_tenant"
on public.tenant_payment_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_payment_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);


-- ============================================================
-- Source: supabase/whatsapp_billing_workflow_support.sql
-- ============================================================

drop function if exists public.admin_generate_billing_cycles_for_all_tenants(date);
drop function if exists public.admin_list_due_cycles_for_date(date);
drop function if exists public.admin_mark_cycle_reminder_sent(uuid, text);

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

