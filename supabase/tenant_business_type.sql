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
