create table if not exists public.tenant_service_staff_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null references public.tenant_services(id) on delete cascade,
  staff_member_id uuid not null references public.tenant_staff_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (service_id, staff_member_id)
);

create index if not exists tenant_service_staff_members_tenant_service_idx
on public.tenant_service_staff_members (tenant_id, service_id);

create index if not exists tenant_service_staff_members_tenant_staff_idx
on public.tenant_service_staff_members (tenant_id, staff_member_id);

alter table public.tenant_service_staff_members enable row level security;

drop policy if exists "tenant_service_staff_members_service_role_all" on public.tenant_service_staff_members;
create policy "tenant_service_staff_members_service_role_all"
on public.tenant_service_staff_members
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "tenant_service_staff_members_read_own_tenant" on public.tenant_service_staff_members;
create policy "tenant_service_staff_members_read_own_tenant"
on public.tenant_service_staff_members
for select
using (
  exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = tenant_service_staff_members.tenant_id
      and tu.auth_user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.tenant_service_staff_members to authenticated, service_role;

insert into public.tenant_service_staff_members (tenant_id, service_id, staff_member_id)
select s.tenant_id, s.id, sm.id
from public.tenant_services s
join public.tenant_staff_members sm
  on sm.tenant_id = s.tenant_id
where s.is_active = true
  and sm.is_active = true
  and not exists (
    select 1
    from public.tenant_service_staff_members link
    where link.service_id = s.id
  )
on conflict do nothing;

create or replace function public.admin_replace_service_staff_members(
  p_tenant_id uuid,
  p_service_id uuid,
  p_staff_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.tenant_services s
    where s.id = p_service_id
      and s.tenant_id = p_tenant_id
      and s.is_active = true
  ) then
    raise exception 'service_not_found';
  end if;

  if coalesce(array_length(p_staff_member_ids, 1), 0) = 0 then
    raise exception 'service_requires_staff_member';
  end if;

  if exists (
    select 1
    from unnest(p_staff_member_ids) as requested(staff_member_id)
    left join public.tenant_staff_members sm
      on sm.id = requested.staff_member_id
     and sm.tenant_id = p_tenant_id
     and sm.is_active = true
    where sm.id is null
  ) then
    raise exception 'staff_member_not_found';
  end if;

  delete from public.tenant_service_staff_members
  where tenant_id = p_tenant_id
    and service_id = p_service_id;

  insert into public.tenant_service_staff_members (
    tenant_id,
    service_id,
    staff_member_id
  )
  select distinct p_tenant_id, p_service_id, requested.staff_member_id
  from unnest(p_staff_member_ids) as requested(staff_member_id);
end;
$$;

grant execute on function public.admin_replace_service_staff_members(uuid, uuid, uuid[]) to authenticated, service_role;

create or replace function public.enforce_appointment_service_staff_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'UPDATE'
     and new.service_id is not distinct from old.service_id
     and new.staff_member_id is not distinct from old.staff_member_id then
    return new;
  end if;

  if new.service_id is null then
    raise exception 'service_required';
  end if;

  if new.staff_member_id is null then
    raise exception 'staff_member_required';
  end if;

  if not exists (
    select 1
    from public.tenant_service_staff_members link
    where link.tenant_id = new.tenant_id
      and link.service_id = new.service_id
      and link.staff_member_id = new.staff_member_id
  ) then
    raise exception 'service_staff_member_not_linked';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_appointment_service_staff_link_trigger on public.appointments;
create trigger enforce_appointment_service_staff_link_trigger
before insert or update of service_id, staff_member_id
on public.appointments
for each row
execute function public.enforce_appointment_service_staff_link();
