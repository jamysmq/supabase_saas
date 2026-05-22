-- Tenant WhatsApp inbox for human handoff.
-- Stores customer conversations separately from bot state in wa_conversations.

create table if not exists public.tenant_whatsapp_threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_phone_e164 text not null,
  customer_name_snapshot text,
  status text not null default 'open' check (status in ('open', 'closed')),
  assigned_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  last_message_preview text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, customer_phone_e164)
);

create table if not exists public.tenant_whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.tenant_whatsapp_threads(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound', 'system')),
  sender_type text not null check (sender_type in ('customer', 'tenant_user', 'bot', 'system')),
  sender_tenant_user_id uuid references public.tenant_users(id) on delete set null,
  provider text not null default 'whatsapp_cloud',
  provider_message_id text,
  status text not null default 'received' check (status in ('received', 'sent', 'failed')),
  body text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists tenant_whatsapp_messages_provider_message_idx
on public.tenant_whatsapp_messages(provider_message_id)
where provider_message_id is not null;

create index if not exists tenant_whatsapp_threads_tenant_status_idx
on public.tenant_whatsapp_threads(tenant_id, status, last_message_at desc);

create index if not exists tenant_whatsapp_messages_thread_created_idx
on public.tenant_whatsapp_messages(thread_id, created_at);

alter table public.tenant_whatsapp_threads enable row level security;
alter table public.tenant_whatsapp_messages enable row level security;

drop policy if exists "tenant_whatsapp_threads_read_own_tenant" on public.tenant_whatsapp_threads;
create policy "tenant_whatsapp_threads_read_own_tenant"
on public.tenant_whatsapp_threads
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_whatsapp_threads.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

drop policy if exists "tenant_whatsapp_messages_read_own_tenant" on public.tenant_whatsapp_messages;
create policy "tenant_whatsapp_messages_read_own_tenant"
on public.tenant_whatsapp_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_whatsapp_messages.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

grant select on public.tenant_whatsapp_threads, public.tenant_whatsapp_messages to authenticated;
grant select, insert, update, delete on public.tenant_whatsapp_threads, public.tenant_whatsapp_messages to service_role;

create or replace function public.admin_record_whatsapp_inbound(
  p_phone_number_id text,
  p_platform_phone_e164 text,
  p_customer_phone_e164 text,
  p_message_id text,
  p_body text,
  p_timestamp text default null,
  p_raw_event jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_phone text;
  v_platform_phone text;
  v_tenant_id uuid;
  v_thread_id uuid;
  v_message_id uuid;
  v_created_at timestamptz;
  v_body text;
begin
  v_customer_phone := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_platform_phone := regexp_replace(coalesce(p_platform_phone_e164, ''), '\D', '', 'g');
  v_body := nullif(trim(coalesce(p_body, '')), '');

  if v_customer_phone = '' or v_body is null then
    return null;
  end if;

  if nullif(trim(coalesce(p_timestamp, '')), '') is not null then
    begin
      v_created_at := to_timestamp(p_timestamp::double precision);
    exception when others then
      v_created_at := now();
    end;
  else
    v_created_at := now();
  end if;

  select c.tenant_id
    into v_tenant_id
  from public.wa_conversations c
  where c.chat_id = v_customer_phone
  order by coalesce(c.last_message_at, c.created_at) desc
  limit 1;

  if v_tenant_id is null and v_platform_phone <> '' then
    select r.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_routing r
    where regexp_replace(r.phone_e164, '\D', '', 'g') = v_platform_phone
      and r.is_active = true
    order by r.tenant_id
    limit 1;
  end if;

  if v_tenant_id is null and v_platform_phone <> '' then
    select n.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_numbers n
    join public.tenants t on t.id = n.tenant_id
    where regexp_replace(n.phone_e164, '\D', '', 'g') = v_platform_phone
      and n.is_active = true
      and t.status = 'active'
    order by n.tenant_id
    limit 1;
  end if;

  if v_tenant_id is null then
    return null;
  end if;

  insert into public.tenant_whatsapp_threads (
    tenant_id,
    customer_phone_e164,
    status,
    last_message_preview,
    last_message_at,
    last_inbound_at,
    unread_count,
    updated_at
  )
  values (
    v_tenant_id,
    v_customer_phone,
    'open',
    left(v_body, 240),
    v_created_at,
    v_created_at,
    1,
    now()
  )
  on conflict (tenant_id, customer_phone_e164)
  do update set
    status = 'open',
    last_message_preview = excluded.last_message_preview,
    last_message_at = excluded.last_message_at,
    last_inbound_at = excluded.last_inbound_at,
    unread_count = public.tenant_whatsapp_threads.unread_count + 1,
    updated_at = now()
  returning id into v_thread_id;

  insert into public.tenant_whatsapp_messages (
    thread_id,
    tenant_id,
    direction,
    sender_type,
    provider,
    provider_message_id,
    status,
    body,
    raw_payload,
    created_at
  )
  values (
    v_thread_id,
    v_tenant_id,
    'inbound',
    'customer',
    'whatsapp_cloud',
    nullif(trim(coalesce(p_message_id, '')), ''),
    'received',
    v_body,
    coalesce(p_raw_event, '{}'::jsonb) || jsonb_build_object(
      'phone_number_id', p_phone_number_id,
      'platform_phone_e164', v_platform_phone
    ),
    v_created_at
  )
  on conflict (provider_message_id) where provider_message_id is not null
  do nothing
  returning id into v_message_id;

  if v_message_id is null then
    update public.tenant_whatsapp_threads
       set unread_count = greatest(unread_count - 1, 0)
     where id = v_thread_id;
  end if;

  return v_thread_id;
end;
$$;

grant execute on function public.admin_record_whatsapp_inbound(text, text, text, text, text, text, jsonb) to service_role;
