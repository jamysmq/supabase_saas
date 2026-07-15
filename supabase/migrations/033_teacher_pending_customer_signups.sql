-- Teacher-owned customer signup approval queue.
-- WhatsApp submissions stay pending until the tenant approves them.

create table if not exists public.tenant_customer_signup_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  full_name text not null,
  customer_phone_e164 text not null,
  cpf text,
  email text,
  group_id uuid references public.tenant_customer_groups(id) on delete set null,
  group_name_snapshot text,
  amount_cents integer not null check (amount_cents > 0),
  due_day integer not null check (due_day between 1 and 31),
  notes text,
  source text not null default 'whatsapp',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  reviewed_at timestamptz,
  customer_id uuid references public.tenant_customers(id) on delete set null,
  billing_cycle_id uuid references public.billing_cycles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_customer_signup_requests_tenant_status_idx
on public.tenant_customer_signup_requests(tenant_id, status, created_at desc);

create unique index if not exists tenant_customer_signup_requests_pending_phone_uq
on public.tenant_customer_signup_requests(tenant_id, customer_phone_e164)
where status = 'pending';

alter table public.tenant_customer_signup_requests enable row level security;

drop policy if exists tenant_customer_signup_requests_read_own_tenant
on public.tenant_customer_signup_requests;
create policy tenant_customer_signup_requests_read_own_tenant
on public.tenant_customer_signup_requests for select to authenticated
using (exists (
  select 1
  from public.tenant_users tu
  join public.tenants t on t.id = tu.tenant_id
  where tu.auth_user_id = auth.uid()
    and tu.tenant_id = tenant_customer_signup_requests.tenant_id
    and t.business_type = 'teacher'
    and t.plan in ('plan1', 'plan3')
));

grant select on public.tenant_customer_signup_requests to authenticated;
grant select, insert, update, delete on public.tenant_customer_signup_requests to service_role;

create or replace function public.wa_billing_signup_submit_request(
  p_tenant_id uuid,
  p_full_name text,
  p_whatsapp_e164 text,
  p_amount_cents integer,
  p_due_day integer,
  p_group_id uuid default null,
  p_group_name text default null,
  p_notes text default null
)
returns table (
  request_id uuid,
  request_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g');
  v_group_name text;
begin
  if not exists (
    select 1 from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
      and t.business_type = 'teacher'
      and t.plan in ('plan1', 'plan3')
  ) then
    raise exception 'teacher_tenant_not_found_or_plan_without_billing';
  end if;

  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'full_name_required';
  end if;
  if v_phone = '' then raise exception 'whatsapp_required'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount'; end if;
  if p_due_day is null or p_due_day not between 1 and 31 then raise exception 'invalid_due_day'; end if;

  if p_group_id is not null then
    select g.name into v_group_name
    from public.tenant_customer_groups g
    where g.id = p_group_id and g.tenant_id = p_tenant_id and g.is_active = true;

    if v_group_name is null then raise exception 'group_not_found'; end if;
  else
    v_group_name := nullif(trim(coalesce(p_group_name, '')), '');
  end if;

  insert into public.tenant_customer_signup_requests as request (
    tenant_id, full_name, customer_phone_e164, group_id, group_name_snapshot,
    amount_cents, due_day, notes, source, status, updated_at
  ) values (
    p_tenant_id, trim(p_full_name), v_phone, p_group_id, v_group_name,
    p_amount_cents, p_due_day, nullif(trim(coalesce(p_notes, '')), ''),
    'whatsapp', 'pending', now()
  )
  on conflict (tenant_id, customer_phone_e164) where status = 'pending'
  do update set
    full_name = excluded.full_name,
    group_id = excluded.group_id,
    group_name_snapshot = excluded.group_name_snapshot,
    amount_cents = excluded.amount_cents,
    due_day = excluded.due_day,
    notes = excluded.notes,
    updated_at = now()
  returning request.id, request.status into request_id, request_status;

  return next;
end;
$$;

create or replace function public.admin_approve_teacher_customer_signup(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reviewed_by_tenant_user_id uuid
)
returns table (
  request_id uuid,
  customer_id uuid,
  billing_cycle_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tenant_customer_signup_requests%rowtype;
  v_customer_id uuid;
  v_billing_cycle_id uuid;
begin
  if not exists (
    select 1 from public.tenant_users tu
    join public.tenants t on t.id = tu.tenant_id
    where tu.id = p_reviewed_by_tenant_user_id
      and tu.tenant_id = p_tenant_id
      and t.business_type = 'teacher'
      and t.plan in ('plan1', 'plan3')
  ) then
    raise exception 'tenant_reviewer_not_allowed';
  end if;

  select * into v_request
  from public.tenant_customer_signup_requests r
  where r.id = p_request_id and r.tenant_id = p_tenant_id
  for update;

  if v_request.id is null then raise exception 'signup_request_not_found'; end if;
  if v_request.status <> 'pending' then raise exception 'signup_request_already_reviewed'; end if;

  select created.customer_id, created.billing_cycle_id
  into v_customer_id, v_billing_cycle_id
  from public.wa_billing_signup_create_customer(
    p_tenant_id,
    v_request.full_name,
    v_request.customer_phone_e164,
    v_request.amount_cents,
    v_request.due_day,
    v_request.group_id,
    v_request.notes
  ) created;

  update public.tenant_customer_signup_requests
  set status = 'approved', reviewed_by_tenant_user_id = p_reviewed_by_tenant_user_id,
      reviewed_at = now(), customer_id = v_customer_id,
      billing_cycle_id = v_billing_cycle_id, updated_at = now()
  where id = v_request.id;

  request_id := v_request.id;
  customer_id := v_customer_id;
  billing_cycle_id := v_billing_cycle_id;
  return next;
end;
$$;

create or replace function public.admin_reject_teacher_customer_signup(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reviewed_by_tenant_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  if not exists (
    select 1 from public.tenant_users tu
    join public.tenants t on t.id = tu.tenant_id
    where tu.id = p_reviewed_by_tenant_user_id
      and tu.tenant_id = p_tenant_id
      and t.business_type = 'teacher'
      and t.plan in ('plan1', 'plan3')
  ) then
    raise exception 'tenant_reviewer_not_allowed';
  end if;

  update public.tenant_customer_signup_requests
  set status = 'rejected', reviewed_by_tenant_user_id = p_reviewed_by_tenant_user_id,
      reviewed_at = now(), updated_at = now()
  where id = p_request_id and tenant_id = p_tenant_id and status = 'pending'
  returning id into v_request_id;

  if v_request_id is null then raise exception 'signup_request_not_found_or_already_reviewed'; end if;
  return v_request_id;
end;
$$;

revoke all on function public.wa_billing_signup_submit_request(uuid, text, text, integer, integer, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.wa_billing_signup_submit_request(uuid, text, text, integer, integer, uuid, text, text)
to service_role;

revoke all on function public.admin_approve_teacher_customer_signup(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_approve_teacher_customer_signup(uuid, uuid, uuid)
to service_role;

revoke all on function public.admin_reject_teacher_customer_signup(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_reject_teacher_customer_signup(uuid, uuid, uuid)
to service_role;
