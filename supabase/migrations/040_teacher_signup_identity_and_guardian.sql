-- Completes teacher WhatsApp signup identity data and stores guardian details
-- for customers who are younger than 14 on the request date.

alter table public.tenant_customer_signup_requests
add column if not exists birth_date date;

alter table public.tenant_customer_signup_requests
add column if not exists guardian_full_name text;

alter table public.tenant_customer_signup_requests
add column if not exists guardian_cpf text;

alter table public.tenant_customers
add column if not exists guardian_full_name text;

alter table public.tenant_customers
add column if not exists guardian_cpf text;

-- Restart only unfinished signup flows so drafts created before the identity
-- fields cannot bypass the new required steps.
update public.wa_conversations
set step = 'billing_signup_welcome',
    payload_draft = jsonb_build_object(
      'flow_version', 3,
      'module', 'billing_signup',
      'signup', jsonb_build_object('customer_whatsapp', chat_id),
      'metadata', jsonb_build_object('restarted_for_identity_fields_at', now())
    ),
    last_message_at = now()
where coalesce(is_closed, false) = false
  and payload_draft ->> 'module' in ('billing', 'billing_signup');

alter table public.tenant_customer_signup_requests
drop constraint if exists tenant_customer_signup_requests_guardian_name_check;

alter table public.tenant_customer_signup_requests
add constraint tenant_customer_signup_requests_guardian_name_check
check (guardian_full_name is null or char_length(trim(guardian_full_name)) between 3 and 160);

alter table public.tenant_customer_signup_requests
drop constraint if exists tenant_customer_signup_requests_guardian_cpf_check;

alter table public.tenant_customer_signup_requests
add constraint tenant_customer_signup_requests_guardian_cpf_check
check (guardian_cpf is null or guardian_cpf ~ '^[0-9]{11}$');

alter table public.tenant_customers
drop constraint if exists tenant_customers_guardian_name_check;

alter table public.tenant_customers
add constraint tenant_customers_guardian_name_check
check (guardian_full_name is null or char_length(trim(guardian_full_name)) between 3 and 160);

alter table public.tenant_customers
drop constraint if exists tenant_customers_guardian_cpf_check;

alter table public.tenant_customers
add constraint tenant_customers_guardian_cpf_check
check (guardian_cpf is null or guardian_cpf ~ '^[0-9]{11}$');

-- A WhatsApp number identifies the contact, not necessarily one student.
-- Siblings and a parent/child can therefore share it. CPF is the student key.
drop index if exists public.tenant_customer_signup_requests_pending_phone_uq;

create unique index if not exists tenant_customer_signup_requests_pending_cpf_uq
on public.tenant_customer_signup_requests (
  tenant_id,
  (regexp_replace(cpf, '\D', '', 'g'))
)
where status = 'pending'
  and cpf is not null
  and regexp_replace(cpf, '\D', '', 'g') <> '';

create unique index if not exists tenant_customers_tenant_cpf_uq
on public.tenant_customers (
  tenant_id,
  (regexp_replace(cpf, '\D', '', 'g'))
)
where cpf is not null
  and regexp_replace(cpf, '\D', '', 'g') <> '';

create or replace function public.wa_billing_signup_submit_request_v4(
  p_tenant_id uuid,
  p_full_name text,
  p_whatsapp_e164 text,
  p_email text,
  p_cpf text,
  p_birth_date date,
  p_guardian_full_name text default null,
  p_guardian_cpf text default null,
  p_group_id uuid default null,
  p_group_name text default null,
  p_signup_plan_id uuid default null,
  p_notes text default null
)
returns table (request_id uuid, request_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_cpf text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_guardian_name text := nullif(trim(coalesce(p_guardian_full_name, '')), '');
  v_guardian_cpf text := nullif(regexp_replace(coalesce(p_guardian_cpf, ''), '\D', '', 'g'), '');
  v_is_under_14 boolean;
  v_mode text;
  v_amount_cents integer;
  v_due_day integer;
  v_plan_name text;
  v_group_name text;
  v_max_members integer;
  v_current_members integer;
  v_existing_request_id uuid;
begin
  if v_email = '' or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'invalid_email';
  end if;

  if length(v_cpf) <> 11 then
    raise exception 'invalid_cpf';
  end if;

  if p_birth_date is null
     or p_birth_date > current_date
     or p_birth_date < (current_date - interval '120 years')::date then
    raise exception 'invalid_birth_date';
  end if;

  v_is_under_14 := p_birth_date > (current_date - interval '14 years')::date;

  if v_is_under_14 then
    if v_guardian_name is null or char_length(v_guardian_name) < 3 then
      raise exception 'guardian_full_name_required';
    end if;
    if v_guardian_cpf is null or length(v_guardian_cpf) <> 11 then
      raise exception 'guardian_cpf_required';
    end if;
  else
    v_guardian_name := null;
    v_guardian_cpf := null;
  end if;

  -- Report duplicates inside the WhatsApp flow instead of overwriting a
  -- customer or letting the HTTP request fail without a useful reply.
  if exists (
    select 1 from public.tenant_customers c
    where c.tenant_id = p_tenant_id
      and regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') = v_cpf
  ) then
    request_id := null;
    request_status := 'cpf_already_registered';
    return next;
    return;
  end if;

  select r.id into v_existing_request_id
  from public.tenant_customer_signup_requests r
  where r.tenant_id = p_tenant_id
    and r.status = 'pending'
    and regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g') = v_cpf
  order by r.created_at desc
  limit 1;

  if v_existing_request_id is not null then
    request_id := v_existing_request_id;
    request_status := 'cpf_already_pending';
    return next;
    return;
  end if;

  select t.whatsapp_signup_billing_mode,
         t.whatsapp_signup_fixed_amount_cents,
         t.whatsapp_signup_fixed_due_day
  into v_mode, v_amount_cents, v_due_day
  from public.tenants t
  where t.id = p_tenant_id
    and t.status = 'active'
    and t.business_type = 'teacher'
    and t.plan in ('plan1', 'plan3')
    and t.whatsapp_customer_signup_enabled = true;

  if not found then raise exception 'whatsapp_customer_signup_disabled'; end if;

  if v_mode = 'plans' then
    select p.amount_cents, p.due_day, p.name
    into v_amount_cents, v_due_day, v_plan_name
    from public.tenant_customer_signup_plans p
    where p.id = p_signup_plan_id
      and p.tenant_id = p_tenant_id
      and p.is_active = true;
    if not found then raise exception 'signup_plan_not_found'; end if;
  elsif v_mode = 'fixed' then
    if v_amount_cents is null or v_due_day is null then
      raise exception 'fixed_signup_billing_not_configured';
    end if;
    v_plan_name := 'Mensalidade fixa';
  else
    raise exception 'invalid_signup_billing_mode';
  end if;

  if p_group_id is not null then
    select g.name, g.max_members,
      (select count(*)::integer from public.tenant_customers c
       where c.tenant_id = p_tenant_id and c.group_id = g.id and c.is_active = true)
    into v_group_name, v_max_members, v_current_members
    from public.tenant_customer_groups g
    where g.id = p_group_id
      and g.tenant_id = p_tenant_id
      and g.is_active = true;

    if not found then raise exception 'group_not_found'; end if;
    if v_max_members is not null and v_current_members >= v_max_members then
      raise exception 'group_is_full';
    end if;
  else
    v_group_name := nullif(trim(coalesce(p_group_name, '')), '');
  end if;

  begin
    insert into public.tenant_customer_signup_requests (
      tenant_id, full_name, customer_phone_e164, cpf, email, birth_date,
      guardian_full_name, guardian_cpf, group_id, group_name_snapshot,
      signup_plan_id, signup_plan_name_snapshot, amount_cents, due_day,
      notes, source, status, updated_at
    ) values (
      p_tenant_id, trim(p_full_name),
      regexp_replace(coalesce(p_whatsapp_e164, ''), '\D', '', 'g'),
      v_cpf, v_email, p_birth_date, v_guardian_name, v_guardian_cpf,
      p_group_id, v_group_name,
      case when v_mode = 'plans' then p_signup_plan_id else null end,
      v_plan_name, v_amount_cents, v_due_day,
      nullif(trim(coalesce(p_notes, '')), ''), 'whatsapp', 'pending', now()
    )
    returning id, status into request_id, request_status;
  exception when unique_violation then
    select r.id into request_id
    from public.tenant_customer_signup_requests r
    where r.tenant_id = p_tenant_id
      and r.status = 'pending'
      and regexp_replace(coalesce(r.cpf, ''), '\D', '', 'g') = v_cpf
    order by r.created_at desc
    limit 1;
    request_status := 'cpf_already_pending';
  end;

  return next;
end;
$$;

create or replace function public.admin_approve_teacher_customer_signup_with_group_v2(
  p_tenant_id uuid,
  p_request_id uuid,
  p_reviewed_by_tenant_user_id uuid,
  p_group_id uuid default null
)
returns table (request_id uuid, customer_id uuid, billing_cycle_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.tenant_customer_signup_requests%rowtype;
  v_customer_id uuid;
  v_billing_cycle_id uuid;
  v_group_name text;
  v_max_members integer;
  v_current_members integer;
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
  where r.id = p_request_id
    and r.tenant_id = p_tenant_id
    and r.status = 'pending'
  for update;

  if v_request.id is null then
    raise exception 'signup_request_not_found_or_already_reviewed';
  end if;

  if v_request.email is null or v_request.cpf is null or v_request.birth_date is null then
    raise exception 'signup_identity_data_incomplete';
  end if;

  if v_request.birth_date > (current_date - interval '14 years')::date
     and (v_request.guardian_full_name is null or v_request.guardian_cpf is null) then
    raise exception 'signup_guardian_data_incomplete';
  end if;

  if exists (
    select 1 from public.tenant_customers c
    where c.tenant_id = p_tenant_id
      and regexp_replace(coalesce(c.cpf, ''), '\D', '', 'g') =
          regexp_replace(v_request.cpf, '\D', '', 'g')
  ) then
    raise exception 'customer_cpf_already_registered';
  end if;

  if p_group_id is not null then
    select g.name, g.max_members
    into v_group_name, v_max_members
    from public.tenant_customer_groups g
    where g.id = p_group_id
      and g.tenant_id = p_tenant_id
      and g.is_active = true
    for update;

    if not found then raise exception 'group_not_found'; end if;

    select count(*)::integer into v_current_members
    from public.tenant_customers c
    where c.tenant_id = p_tenant_id
      and c.group_id = p_group_id
      and c.is_active = true;

    if v_max_members is not null and v_current_members >= v_max_members then
      raise exception 'group_is_full';
    end if;
  end if;

  insert into public.tenant_customers (
    tenant_id, full_name, phone_e164, email, cpf, birth_date,
    guardian_full_name, guardian_cpf, notes, is_active, group_id
  ) values (
    p_tenant_id, trim(v_request.full_name), v_request.customer_phone_e164,
    v_request.email, regexp_replace(v_request.cpf, '\D', '', 'g'),
    v_request.birth_date, v_request.guardian_full_name,
    v_request.guardian_cpf, v_request.notes, true, p_group_id
  ) returning id into v_customer_id;

  perform public.admin_create_billing_profile(
    p_tenant_id, v_customer_id, v_request.amount_cents,
    v_request.due_day, null, null
  );

  v_billing_cycle_id := public.admin_create_initial_customer_billing_cycle(
    p_tenant_id, v_customer_id
  );

  update public.tenant_customer_signup_requests
  set status = 'approved', group_id = p_group_id,
      group_name_snapshot = v_group_name,
      reviewed_by_tenant_user_id = p_reviewed_by_tenant_user_id,
      reviewed_at = now(), customer_id = v_customer_id,
      billing_cycle_id = v_billing_cycle_id, updated_at = now()
  where id = v_request.id;

  request_id := v_request.id;
  customer_id := v_customer_id;
  billing_cycle_id := v_billing_cycle_id;
  return next;
end;
$$;

revoke all on function public.wa_billing_signup_submit_request_v4(
  uuid, text, text, text, text, date, text, text, uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.wa_billing_signup_submit_request_v4(
  uuid, text, text, text, text, date, text, text, uuid, text, uuid, text
) to service_role;

revoke all on function public.admin_approve_teacher_customer_signup_with_group_v2(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.admin_approve_teacher_customer_signup_with_group_v2(uuid, uuid, uuid, uuid)
to service_role;
