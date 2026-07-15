-- Keeps one active tenant per customer phone for two hours of inactivity.
-- Conversation history remains stored independently inside each tenant.

-- The tenant entry menu is owned by the platform because its options must
-- always match the enabled plan capabilities. Module-specific greetings
-- (appointments, billing and catalog) remain configurable by each tenant.
delete from public.tenant_message_templates
where template_key = 'tenant_welcome';

create or replace function public.prevent_configurable_tenant_welcome()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'tenant_welcome_is_platform_managed';
end;
$$;

drop trigger if exists tenant_message_templates_block_tenant_welcome
on public.tenant_message_templates;

create trigger tenant_message_templates_block_tenant_welcome
before insert or update on public.tenant_message_templates
for each row
when (new.template_key = 'tenant_welcome')
execute function public.prevent_configurable_tenant_welcome();

create table if not exists public.platform_whatsapp_tenant_sessions (
  customer_phone_e164 text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null default 'conversation',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_whatsapp_tenant_sessions_expiry_idx
on public.platform_whatsapp_tenant_sessions(expires_at);

alter table public.platform_whatsapp_tenant_sessions enable row level security;
revoke all on public.platform_whatsapp_tenant_sessions from anon, authenticated;
grant select, insert, update, delete on public.platform_whatsapp_tenant_sessions to service_role;

create or replace function public.admin_touch_whatsapp_tenant_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.platform_whatsapp_tenant_sessions (
      customer_phone_e164, tenant_id, source, expires_at, updated_at
    ) values (
      regexp_replace(new.customer_phone_e164, '\D', '', 'g'),
      new.tenant_id,
      'tenant_inbound',
      now() + interval '2 hours',
      now()
    )
    on conflict (customer_phone_e164) do update set
      tenant_id = excluded.tenant_id,
      source = excluded.source,
      expires_at = excluded.expires_at,
      updated_at = now();
  elsif new.last_inbound_at is distinct from old.last_inbound_at then
    insert into public.platform_whatsapp_tenant_sessions (
      customer_phone_e164, tenant_id, source, expires_at, updated_at
    ) values (
      regexp_replace(new.customer_phone_e164, '\D', '', 'g'),
      new.tenant_id,
      'tenant_inbound',
      now() + interval '2 hours',
      now()
    )
    on conflict (customer_phone_e164) do update set
      tenant_id = excluded.tenant_id,
      source = excluded.source,
      expires_at = excluded.expires_at,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_whatsapp_threads_touch_session
on public.tenant_whatsapp_threads;

create trigger tenant_whatsapp_threads_touch_session
after insert or update of last_inbound_at on public.tenant_whatsapp_threads
for each row execute function public.admin_touch_whatsapp_tenant_session();

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
  v_previous_tenant_id uuid;
  v_thread_id uuid;
  v_message_id uuid;
  v_created_at timestamptz;
  v_body text;
  v_normalized_body text;
  v_link_code text;
begin
  v_customer_phone := regexp_replace(coalesce(p_customer_phone_e164, ''), '\D', '', 'g');
  v_platform_phone := regexp_replace(coalesce(p_platform_phone_e164, ''), '\D', '', 'g');
  v_body := nullif(trim(coalesce(p_body, '')), '');
  v_normalized_body := translate(lower(coalesce(v_body, '')), 'áàãâéêíóôõúç', 'aaaaeeiooouc');

  if v_customer_phone = '' or v_body is null then
    return null;
  end if;

  if v_normalized_body in ('menu principal', 'trocar de negocio', 'outro negocio', 'mudar de negocio', 'sair do negocio') then
    select s.tenant_id into v_previous_tenant_id
    from public.platform_whatsapp_tenant_sessions s
    where s.customer_phone_e164 = v_customer_phone;

    delete from public.platform_whatsapp_tenant_sessions
    where customer_phone_e164 = v_customer_phone;

    if v_previous_tenant_id is not null then
      update public.tenant_whatsapp_threads
      set status = 'closed', updated_at = now()
      where tenant_id = v_previous_tenant_id
        and regexp_replace(customer_phone_e164, '\D', '', 'g') = v_customer_phone
        and status = 'open';
    end if;

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

  select lower(matches.captures[1]) into v_link_code
  from regexp_matches(lower(v_body), '(jack-[a-z0-9]{8})') as matches(captures)
  limit 1;

  if v_link_code is not null then
    select l.tenant_id into v_tenant_id
    from public.tenant_whatsapp_entry_links l
    join public.tenants t on t.id = l.tenant_id
    where l.code = v_link_code and l.is_active = true and t.status = 'active'
    limit 1;
  end if;

  if v_tenant_id is null then
    select s.tenant_id into v_tenant_id
    from public.platform_whatsapp_tenant_sessions s
    join public.tenants t on t.id = s.tenant_id
    where s.customer_phone_e164 = v_customer_phone
      and s.expires_at > now()
      and t.status = 'active'
    limit 1;
  end if;

  delete from public.platform_whatsapp_tenant_sessions
  where customer_phone_e164 = v_customer_phone and expires_at <= now();

  -- Compatibility for conversations created before this session table existed.
  if v_tenant_id is null then
    select c.tenant_id into v_tenant_id
    from public.wa_conversations c
    join public.tenants t on t.id = c.tenant_id
    where c.chat_id = v_customer_phone
      and coalesce(c.last_message_at, c.created_at) > now() - interval '2 hours'
      and t.status = 'active'
    order by coalesce(c.last_message_at, c.created_at) desc
    limit 1;
  end if;

  if v_tenant_id is null and v_platform_phone <> '' then
    select r.tenant_id into v_tenant_id
    from public.tenant_whatsapp_routing r
    join public.tenants t on t.id = r.tenant_id
    where regexp_replace(r.phone_e164, '\D', '', 'g') = v_platform_phone
      and r.is_active = true and t.status = 'active'
    order by r.tenant_id limit 1;
  end if;

  if v_tenant_id is null and v_platform_phone <> '' then
    select n.tenant_id into v_tenant_id
    from public.tenant_whatsapp_numbers n
    join public.tenants t on t.id = n.tenant_id
    where regexp_replace(n.phone_e164, '\D', '', 'g') = v_platform_phone
      and n.is_active = true and t.status = 'active'
    order by n.tenant_id limit 1;
  end if;

  if v_tenant_id is null then return null; end if;

  insert into public.tenant_whatsapp_threads (
    tenant_id, customer_phone_e164, status, last_message_preview,
    last_message_at, last_inbound_at, unread_count, updated_at
  ) values (
    v_tenant_id, v_customer_phone, 'open', left(v_body, 240),
    v_created_at, v_created_at, 1, now()
  )
  on conflict (tenant_id, customer_phone_e164) do update set
    status = 'open', last_message_preview = excluded.last_message_preview,
    last_message_at = excluded.last_message_at, last_inbound_at = excluded.last_inbound_at,
    unread_count = public.tenant_whatsapp_threads.unread_count + 1, updated_at = now()
  returning id into v_thread_id;

  insert into public.tenant_whatsapp_messages (
    thread_id, tenant_id, direction, sender_type, provider,
    provider_message_id, status, body, raw_payload, created_at
  ) values (
    v_thread_id, v_tenant_id, 'inbound', 'customer', 'whatsapp_cloud',
    nullif(trim(coalesce(p_message_id, '')), ''), 'received', v_body,
    coalesce(p_raw_event, '{}'::jsonb) || jsonb_build_object(
      'phone_number_id', p_phone_number_id,
      'platform_phone_e164', v_platform_phone,
      'entry_link_code', v_link_code
    ), v_created_at
  )
  on conflict (provider_message_id) where provider_message_id is not null
  do nothing returning id into v_message_id;

  if v_message_id is null then
    update public.tenant_whatsapp_threads
    set unread_count = greatest(unread_count - 1, 0)
    where id = v_thread_id;
  end if;

  return v_thread_id;
end;
$$;

revoke all on function public.admin_record_whatsapp_inbound(text, text, text, text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.admin_record_whatsapp_inbound(text, text, text, text, text, text, jsonb)
to service_role;
