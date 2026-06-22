-- Tenant-specific WhatsApp entry links.
-- Apply after supabase/tenant_whatsapp_inbox.sql if that file was already applied before this feature.

create table if not exists public.tenant_whatsapp_entry_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id),
  unique (code),
  check (code ~ '^jack-[a-z0-9]{8}$')
);

create index if not exists tenant_whatsapp_entry_links_code_active_idx
on public.tenant_whatsapp_entry_links(code)
where is_active = true;

alter table public.tenant_whatsapp_entry_links enable row level security;

drop policy if exists "tenant_whatsapp_entry_links_read_own_tenant" on public.tenant_whatsapp_entry_links;
create policy "tenant_whatsapp_entry_links_read_own_tenant"
on public.tenant_whatsapp_entry_links
for select
to authenticated
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_whatsapp_entry_links.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

grant select on public.tenant_whatsapp_entry_links to authenticated;
grant select, insert, update, delete on public.tenant_whatsapp_entry_links to service_role;

drop function if exists public.admin_ensure_tenant_whatsapp_entry_link(uuid);

create or replace function public.admin_ensure_tenant_whatsapp_entry_link(
  p_tenant_id uuid
)
returns table (
  link_tenant_id uuid,
  code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_attempts integer := 0;
begin
  if not exists (
    select 1
    from public.tenants t
    where t.id = p_tenant_id
      and t.status = 'active'
  ) then
    return;
  end if;

  return query
  select l.tenant_id, l.code
  from public.tenant_whatsapp_entry_links l
  where l.tenant_id = p_tenant_id
    and l.is_active = true
  limit 1;

  if found then
    return;
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := 'jack-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    begin
      insert into public.tenant_whatsapp_entry_links (tenant_id, code)
      values (p_tenant_id, v_code)
      on conflict (tenant_id) do update
        set is_active = true,
            updated_at = now()
      returning public.tenant_whatsapp_entry_links.tenant_id, public.tenant_whatsapp_entry_links.code
      into link_tenant_id, code;

      return next;
      return;
    exception when unique_violation then
      if v_attempts >= 5 then
        raise;
      end if;
    end;
  end loop;
end;
$$;

grant execute on function public.admin_ensure_tenant_whatsapp_entry_link(uuid) to service_role;

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
  v_existing_thread_id uuid;
  v_message_id uuid;
  v_created_at timestamptz;
  v_body text;
  v_link_code text;
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

  select lower(matches.captures[1])
    into v_link_code
  from regexp_matches(lower(v_body), '(jack-[a-z0-9]{8})') as matches(captures)
  limit 1;

  if v_link_code is not null then
    select l.tenant_id
      into v_tenant_id
    from public.tenant_whatsapp_entry_links l
    join public.tenants t on t.id = l.tenant_id
    where l.code = v_link_code
      and l.is_active = true
      and t.status = 'active'
    limit 1;
  end if;

  if v_tenant_id is null then
    select c.tenant_id
      into v_tenant_id
    from public.wa_conversations c
    where c.chat_id = v_customer_phone
    order by coalesce(c.last_message_at, c.created_at) desc
    limit 1;
  end if;

  if v_tenant_id is null then
    select th.tenant_id, th.id
      into v_tenant_id, v_existing_thread_id
    from public.tenant_whatsapp_threads th
    join public.tenants t on t.id = th.tenant_id
    where t.status = 'active'
      and th.status = 'open'
      and regexp_replace(th.customer_phone_e164, '\D', '', 'g') in (
        v_customer_phone,
        case
          when v_customer_phone ~ '^55[0-9]{2}9[0-9]{8}$'
          then substring(v_customer_phone from 1 for 4) || substring(v_customer_phone from 6)
          else null
        end,
        case
          when v_customer_phone ~ '^55[0-9]{2}[0-9]{8}$'
          then substring(v_customer_phone from 1 for 4) || '9' || substring(v_customer_phone from 5)
          else null
        end
      )
    order by coalesce(th.last_message_at, th.updated_at) desc
    limit 1;
  end if;

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

  if v_existing_thread_id is not null then
    update public.tenant_whatsapp_threads
       set status = 'open',
           last_message_preview = left(v_body, 240),
           last_message_at = v_created_at,
           last_inbound_at = v_created_at,
           unread_count = unread_count + 1,
           updated_at = now()
     where id = v_existing_thread_id
     returning id into v_thread_id;
  else
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
  end if;

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
      'platform_phone_e164', v_platform_phone,
      'entry_link_code', v_link_code
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
