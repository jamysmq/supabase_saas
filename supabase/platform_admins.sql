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
