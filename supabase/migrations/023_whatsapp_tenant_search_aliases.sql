-- Adds human-friendly search aliases derived from each tenant business type.

create or replace function public.whatsapp_business_type_label(p_business_type text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select case lower(coalesce(p_business_type, ''))
    when 'teacher' then 'professor'
    when 'salon' then 'salao beleza'
    when 'clinic' then 'clinica consulta'
    when 'restaurant' then 'restaurante comida'
    when 'autonomous' then 'autonomo profissional'
    when 'loja_material' then 'loja material construcao'
    when 'petshop' then 'pet shop animais'
    else replace(lower(coalesce(p_business_type, '')), '_', ' ')
  end;
$$;

create or replace function public.whatsapp_tenant_derived_aliases(
  p_legal_name text,
  p_public_name text,
  p_business_type text
)
returns text[]
language sql
immutable
parallel safe
set search_path = public
as $$
  with values_to_add as (
    select nullif(trim(public.whatsapp_business_type_label(p_business_type)), '') as value
    union
    select nullif(trim(
      public.whatsapp_business_type_label(p_business_type) || ' ' ||
      split_part(coalesce(nullif(trim(p_public_name), ''), trim(p_legal_name)), ' ', 1)
    ), '')
  )
  select coalesce(array_agg(value order by value), '{}'::text[])
  from values_to_add
  where value is not null;
$$;

create or replace function public.admin_sync_whatsapp_tenant_search_aliases()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.search_aliases := array(
    select distinct alias
    from unnest(
      coalesce(new.search_aliases, '{}'::text[]) ||
      public.whatsapp_tenant_derived_aliases(new.legal_name, new.public_name, new.business_type)
    ) alias
    where nullif(trim(alias), '') is not null
    order by alias
  );
  return new;
end;
$$;

drop trigger if exists tenants_sync_whatsapp_search_aliases on public.tenants;
create trigger tenants_sync_whatsapp_search_aliases
before insert or update of legal_name, public_name, business_type, search_aliases
on public.tenants
for each row execute function public.admin_sync_whatsapp_tenant_search_aliases();

update public.tenants
set search_aliases = search_aliases || public.whatsapp_tenant_derived_aliases(
  legal_name, public_name, business_type
);
