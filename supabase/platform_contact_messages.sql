create table if not exists public.platform_contact_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_admin_auth_user_id uuid references public.platform_admins(auth_user_id) on delete set null,
  name text not null,
  email text not null,
  whatsapp_e164 text,
  subject text,
  body text not null,
  status text not null default 'new'
    check (status in ('new', 'read', 'archived')),
  source text not null default 'public_home_contact',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_contact_messages_recipient_status_idx
on public.platform_contact_messages (recipient_admin_auth_user_id, status, created_at desc);

create index if not exists platform_contact_messages_created_idx
on public.platform_contact_messages (created_at desc);

alter table public.platform_contact_messages enable row level security;

drop policy if exists "platform_contact_messages_read_platform_admin"
on public.platform_contact_messages;

create policy "platform_contact_messages_read_platform_admin"
on public.platform_contact_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_admins pa
    where pa.auth_user_id = auth.uid()
      and pa.is_active = true
  )
);

grant select on public.platform_contact_messages to authenticated;
grant select, insert, update, delete on public.platform_contact_messages to service_role;
