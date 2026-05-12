create or replace function public.platform_create_tenant(
  p_legal_name text,
  p_cpf text,
  p_email text,
  p_birth_date date,
  p_whatsapp_e164 text,
  p_plan text,
  p_status text,
  p_monthly_amount_cents integer,
  p_due_day integer,
  p_admin_email text default null::text
)
returns table(
  tenant_id uuid,
  tenant_user_id uuid,
  subscription_id uuid,
  billing_profile_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_tenant_user_id uuid;
  v_subscription_id uuid;
  v_billing_profile_id uuid;
  v_admin_email text;
  v_plan text;
  v_status text;
begin
  if not exists (
    select 1
    from public.platform_admins pa
    where pa.auth_user_id = auth.uid()
      and pa.is_active = true
  ) then
    raise exception 'not_allowed';
  end if;

  if nullif(trim(p_legal_name), '') is null then
    raise exception 'legal_name_required';
  end if;

  if nullif(trim(p_cpf), '') is null then
    raise exception 'cpf_required';
  end if;

  if nullif(trim(p_email), '') is null then
    raise exception 'email_required';
  end if;

  if nullif(trim(p_whatsapp_e164), '') is null then
    raise exception 'whatsapp_required';
  end if;

  if p_monthly_amount_cents is null or p_monthly_amount_cents <= 0 then
    raise exception 'invalid_monthly_amount';
  end if;

  if p_due_day is null or p_due_day < 1 or p_due_day > 31 then
    raise exception 'invalid_due_day';
  end if;

  v_admin_email := coalesce(nullif(trim(p_admin_email), ''), trim(p_email));
  v_plan := coalesce(nullif(trim(p_plan), ''), 'plan1');
  v_status := coalesce(nullif(trim(p_status), ''), 'active');

  select t.id
    into v_tenant_id
  from public.tenants t
  where t.email = trim(p_email)
     or t.cpf = trim(p_cpf)
  limit 1;

  if v_tenant_id is null then
    insert into public.tenants (
      status,
      plan,
      legal_name,
      cpf,
      email,
      birth_date,
      whatsapp_e164
    )
    values (
      v_status,
      v_plan,
      trim(p_legal_name),
      trim(p_cpf),
      trim(p_email),
      p_birth_date,
      trim(p_whatsapp_e164)
    )
    returning id into v_tenant_id;
  else
    update public.tenants t
    set
      status = v_status,
      plan = v_plan,
      legal_name = trim(p_legal_name),
      cpf = trim(p_cpf),
      email = trim(p_email),
      birth_date = p_birth_date,
      whatsapp_e164 = trim(p_whatsapp_e164),
      updated_at = now()
    where t.id = v_tenant_id;
  end if;

  insert into public.tenant_billing_settings (
    tenant_id,
    default_due_template_key,
    default_overdue_template_key,
    timezone,
    max_customer_groups
  )
  values (
    v_tenant_id,
    'customer_payment_due',
    'customer_payment_overdue',
    'America/Fortaleza',
    20
  )
  on conflict on constraint tenant_billing_settings_pkey do nothing;

  select tu.id
    into v_tenant_user_id
  from public.tenant_users tu
  where tu.tenant_id = v_tenant_id
    and tu.email = v_admin_email
  limit 1;

  if v_tenant_user_id is null then
    insert into public.tenant_users (
      tenant_id,
      role,
      email,
      must_change_password
    )
    values (
      v_tenant_id,
      'admin',
      v_admin_email,
      true
    )
    returning id into v_tenant_user_id;
  end if;

  select s.id
    into v_subscription_id
  from public.subscriptions s
  where s.tenant_id = v_tenant_id
  order by s.created_at desc
  limit 1;

  if v_subscription_id is null then
    insert into public.subscriptions (
      tenant_id,
      plan,
      status
    )
    values (
      v_tenant_id,
      v_plan,
      'active'
    )
    returning id into v_subscription_id;
  else
    update public.subscriptions s
    set
      plan = v_plan,
      status = 'active'
    where s.id = v_subscription_id;
  end if;

  select bp.id
    into v_billing_profile_id
  from public.platform_tenant_billing_profiles bp
  where bp.tenant_id = v_tenant_id
    and bp.status = 'active'
  limit 1;

  if v_billing_profile_id is null then
    insert into public.platform_tenant_billing_profiles (
      tenant_id,
      subscription_id,
      amount_cents,
      currency,
      due_day,
      start_date,
      status,
      message_template_key
    )
    values (
      v_tenant_id,
      v_subscription_id,
      p_monthly_amount_cents,
      'BRL',
      p_due_day,
      current_date,
      'active',
      'platform_monthly_due'
    )
    returning id into v_billing_profile_id;
  else
    update public.platform_tenant_billing_profiles bp
    set
      subscription_id = v_subscription_id,
      amount_cents = p_monthly_amount_cents,
      due_day = p_due_day,
      updated_at = now()
    where bp.id = v_billing_profile_id;
  end if;

  return query
  select
    v_tenant_id,
    v_tenant_user_id,
    v_subscription_id,
    v_billing_profile_id;
end;
$$;

grant execute on function public.platform_create_tenant(
  text,
  text,
  text,
  date,
  text,
  text,
  text,
  integer,
  integer,
  text
) to authenticated;
