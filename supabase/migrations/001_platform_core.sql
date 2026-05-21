-- Migration: 001_platform_core.sql
-- Generated from existing loose SQL files. Keep source files until this is tested in staging.
-- Source files:
-- - supabase/platform_admins.sql
-- - supabase/tenant_business_type.sql
-- - supabase/platform_plan_catalog.sql
-- - supabase/tenant_group_limit_20.sql
-- - supabase/platform_plan4_constraints.sql
-- - supabase/platform_create_tenant_fix.sql


-- ============================================================
-- Source: supabase/platform_admins.sql
-- ============================================================

create table if not exists public.platform_admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

drop policy if exists "platform_admins_read_self" on public.platform_admins;
create policy "platform_admins_read_self"
on public.platform_admins
for select
to authenticated
using (auth_user_id = auth.uid());

create index if not exists platform_admins_email_idx
on public.platform_admins (email);

-- Depois de criar o Auth User do operador geral, rode:
-- insert into public.platform_admins (auth_user_id, email, role)
-- values ('AUTH_USER_ID_AQUI', 'seu@email.com', 'admin')
-- on conflict (auth_user_id) do update
-- set email = excluded.email,
--     role = excluded.role,
--     is_active = true,
--     updated_at = now();


-- ============================================================
-- Source: supabase/tenant_business_type.sql
-- ============================================================

alter table public.tenants
add column if not exists business_type text not null default 'teacher';

alter table public.tenants
drop constraint if exists tenants_business_type_check;

alter table public.tenants
add constraint tenants_business_type_check
check (business_type in ('teacher', 'autonomous', 'clinic', 'salon', 'restaurant'));

update public.tenants
set business_type = 'teacher'
where business_type is null;

create index if not exists tenants_business_type_idx
on public.tenants (business_type);


-- ============================================================
-- Source: supabase/platform_plan_catalog.sql
-- ============================================================

insert into public.platform_plans (
  code,
  name,
  description,
  monthly_amount_cents,
  currency,
  billing_interval,
  max_customer_groups,
  is_active,
  sort_order,
  updated_at
)
values
  (
    'plan1',
    'Plano 1 - Cobrancas',
    'Cobrancas mensais via WhatsApp e controle de alunos/clientes no site.',
    0,
    'BRL',
    'monthly',
    20,
    true,
    10,
    now()
  ),
  (
    'plan2',
    'Plano 2 - Agenda',
    'Agendamento via WhatsApp e controle de agendamentos no site.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    20,
    now()
  ),
  (
    'plan3',
    'Plano 3 - Completo',
    'Soma do Plano 1 e Plano 2: cobrancas, alunos/clientes e agenda.',
    0,
    'BRL',
    'monthly',
    20,
    true,
    30,
    now()
  ),
  (
    'plan4',
    'Plano 4 - Restaurantes',
    'Restaurante com cardapio, pedidos, financeiro e workflow WhatsApp proprio.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    40,
    now()
  ),
  (
    'plan5',
    'Plano 5 - Restaurantes + reservas',
    'Tudo do Plano 4, com agenda de mesas/reservas como feature planejada para restaurante.',
    0,
    'BRL',
    'monthly',
    0,
    true,
    50,
    now()
  )
on conflict (code)
do update set
  name = excluded.name,
  description = excluded.description,
  currency = excluded.currency,
  billing_interval = excluded.billing_interval,
  max_customer_groups = excluded.max_customer_groups,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();


-- ============================================================
-- Source: supabase/tenant_group_limit_20.sql
-- ============================================================

update public.tenant_billing_settings
set max_customer_groups = 20,
    updated_at = now()
where max_customer_groups is distinct from 20;

alter table public.tenant_billing_settings
alter column max_customer_groups set default 20;


-- ============================================================
-- Source: supabase/platform_plan4_constraints.sql
-- ============================================================

do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'subscriptions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.subscriptions drop constraint if exists %I', v_constraint_name);
  end loop;

  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenants'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%business_type%'
  loop
    execute format('alter table public.tenants drop constraint if exists %I', v_constraint_name);
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('plan1', 'plan2', 'plan3', 'plan4', 'plan5'));

alter table public.tenants
  add constraint tenants_business_type_check
  check (business_type in ('teacher', 'autonomous', 'clinic', 'salon', 'restaurant'));


-- ============================================================
-- Source: supabase/platform_create_tenant_fix.sql
-- ============================================================

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

