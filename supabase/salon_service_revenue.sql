create table if not exists public.tenant_service_revenue_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid references public.tenant_services(id) on delete set null,
  staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  customer_name_snapshot text,
  customer_document_snapshot text,
  customer_phone_snapshot text,
  service_name_snapshot text,
  staff_member_name_snapshot text,
  amount_cents integer not null default 0,
  currency text not null default 'BRL',
  status text not null default 'recognized',
  source text not null default 'system',
  recognized_at timestamptz not null default now(),
  voided_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_service_revenue_events
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists appointment_id uuid references public.appointments(id) on delete cascade,
  add column if not exists service_id uuid references public.tenant_services(id) on delete set null,
  add column if not exists staff_member_id uuid references public.tenant_staff_members(id) on delete set null,
  add column if not exists customer_name_snapshot text,
  add column if not exists customer_document_snapshot text,
  add column if not exists customer_phone_snapshot text,
  add column if not exists service_name_snapshot text,
  add column if not exists staff_member_name_snapshot text,
  add column if not exists amount_cents integer not null default 0,
  add column if not exists currency text not null default 'BRL',
  add column if not exists status text not null default 'recognized',
  add column if not exists source text not null default 'system',
  add column if not exists recognized_at timestamptz not null default now(),
  add column if not exists voided_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists tenant_service_revenue_events_appointment_uidx
on public.tenant_service_revenue_events (appointment_id);

create index if not exists tenant_service_revenue_events_tenant_recognized_idx
on public.tenant_service_revenue_events (tenant_id, recognized_at desc);

alter table public.tenant_service_revenue_events enable row level security;

grant select
on public.tenant_service_revenue_events
to authenticated;

grant select, insert, update, delete
on public.tenant_service_revenue_events
to service_role;

drop policy if exists "tenant_service_revenue_events_read_own_tenant" on public.tenant_service_revenue_events;
create policy "tenant_service_revenue_events_read_own_tenant"
on public.tenant_service_revenue_events
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_service_revenue_events.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

create or replace function public.admin_sync_appointment_service_revenue(
  p_appointment_id uuid,
  p_source text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_event_id uuid;
begin
  select
    a.id as appointment_id,
    a.tenant_id,
    a.service_id,
    a.staff_member_id,
    a.status as appointment_status,
    coalesce(tc.full_name, ec.full_name) as customer_name,
    coalesce(tc.cpf, ec.cpf) as customer_document,
    coalesce(tc.phone_e164, ec.whatsapp_e164) as customer_phone,
    coalesce(a.service_name_snapshot, s.name) as service_name,
    coalesce(a.staff_member_name_snapshot, sm.name) as staff_member_name,
    coalesce(s.price_cents, 0) as amount_cents,
    t.business_type
    into v_row
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id
  left join public.tenant_customers tc on tc.id = a.tenant_customer_id
  left join public.end_customers ec on ec.id = a.end_customer_id
  left join public.tenant_services s on s.id = a.service_id
  left join public.tenant_staff_members sm on sm.id = a.staff_member_id
  where a.id = p_appointment_id
    and a.deleted_at is null;

  if v_row.appointment_id is null then
    raise exception 'appointment_not_found';
  end if;

  if v_row.business_type <> 'salon' then
    return null;
  end if;

  if v_row.appointment_status = 'confirmed' and v_row.amount_cents > 0 then
    insert into public.tenant_service_revenue_events (
      tenant_id,
      appointment_id,
      service_id,
      staff_member_id,
      customer_name_snapshot,
      customer_document_snapshot,
      customer_phone_snapshot,
      service_name_snapshot,
      staff_member_name_snapshot,
      amount_cents,
      status,
      source,
      recognized_at,
      voided_at,
      payload
    )
    values (
      v_row.tenant_id,
      v_row.appointment_id,
      v_row.service_id,
      v_row.staff_member_id,
      v_row.customer_name,
      v_row.customer_document,
      v_row.customer_phone,
      v_row.service_name,
      v_row.staff_member_name,
      v_row.amount_cents,
      'recognized',
      coalesce(nullif(trim(p_source), ''), 'system'),
      now(),
      null,
      jsonb_build_object('appointment_status', v_row.appointment_status)
    )
    on conflict (appointment_id)
    do update set
      service_id = excluded.service_id,
      staff_member_id = excluded.staff_member_id,
      customer_name_snapshot = excluded.customer_name_snapshot,
      customer_document_snapshot = excluded.customer_document_snapshot,
      customer_phone_snapshot = excluded.customer_phone_snapshot,
      service_name_snapshot = excluded.service_name_snapshot,
      staff_member_name_snapshot = excluded.staff_member_name_snapshot,
      amount_cents = excluded.amount_cents,
      status = 'recognized',
      source = excluded.source,
      voided_at = null,
      payload = excluded.payload,
      updated_at = now()
    returning id into v_event_id;

    return v_event_id;
  end if;

  update public.tenant_service_revenue_events
  set
    status = 'voided',
    voided_at = coalesce(voided_at, now()),
    source = coalesce(nullif(trim(p_source), ''), source),
    updated_at = now(),
    payload = jsonb_build_object('appointment_status', v_row.appointment_status)
  where appointment_id = p_appointment_id
    and status = 'recognized'
  returning id into v_event_id;

  return v_event_id;
end;
$$;

grant execute on function public.admin_sync_appointment_service_revenue(uuid, text) to authenticated, service_role;
