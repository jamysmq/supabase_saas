-- Introduce the Assistente João public identity without breaking legacy Jack
-- entry links, commands, conversations, or historical payment references.

do $$
declare
  v_constraint_name name;
begin
  select constraint_record.conname
    into v_constraint_name
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'public.tenant_whatsapp_entry_links'::regclass
    and constraint_record.contype = 'c'
    and pg_get_constraintdef(constraint_record.oid) like '%jack-%'
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.tenant_whatsapp_entry_links drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

alter table public.tenant_whatsapp_entry_links
  drop constraint if exists tenant_whatsapp_entry_links_code_brand_check;

alter table public.tenant_whatsapp_entry_links
  add constraint tenant_whatsapp_entry_links_code_brand_check
  check (code ~ '^(jack|mav)-[a-z0-9]{8}$');

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
    from public.tenants tenant
    where tenant.id = p_tenant_id
      and tenant.status = 'active'
  ) then
    return;
  end if;

  return query
  select entry_link.tenant_id, entry_link.code
  from public.tenant_whatsapp_entry_links entry_link
  where entry_link.tenant_id = p_tenant_id
    and entry_link.is_active = true
  limit 1;

  if found then
    return;
  end if;

  loop
    v_attempts := v_attempts + 1;
    v_code := 'mav-' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    begin
      insert into public.tenant_whatsapp_entry_links (tenant_id, code)
      values (p_tenant_id, v_code)
      on conflict (tenant_id) do update
        set is_active = true,
            updated_at = now()
      returning
        public.tenant_whatsapp_entry_links.tenant_id,
        public.tenant_whatsapp_entry_links.code
      into link_tenant_id, code;

      return next;
      return;
    exception
      when unique_violation then
        if v_attempts >= 5 then
          raise;
        end if;
    end;
  end loop;
end;
$$;

revoke all on function public.admin_ensure_tenant_whatsapp_entry_link(uuid)
from public, anon, authenticated;
grant execute on function public.admin_ensure_tenant_whatsapp_entry_link(uuid)
to service_role;

-- Update every current public function that recognizes an entry-link code.
-- Capitalized replacements affect public copy only; lowercase legacy commands
-- such as "menu do jack" remain accepted.
do $$
declare
  v_function record;
  v_definition text;
  v_updated_definition text;
begin
  for v_function in
    select procedure_record.oid
    from pg_proc procedure_record
    join pg_namespace namespace_record
      on namespace_record.oid = procedure_record.pronamespace
    where namespace_record.nspname = 'public'
      and procedure_record.prokind = 'f'
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated_definition := replace(
      v_definition,
      '(jack-[a-z0-9]{8})',
      '(jack-[a-z0-9]{8}|mav-[a-z0-9]{8})'
    );
    v_updated_definition := replace(v_updated_definition, 'Assistente Jack', 'Assistente João');
    v_updated_definition := replace(v_updated_definition, 'Menu do Jack', 'Menu do João');
    v_updated_definition := replace(v_updated_definition, 'O Jack', 'O João');
    v_updated_definition := replace(v_updated_definition, 'o Jack', 'o João');
    v_updated_definition := replace(v_updated_definition, ', ''jack'',', ', ''jack'', ''joao'',');

    if v_updated_definition <> v_definition then
      execute v_updated_definition;
    end if;
  end loop;
end;
$$;

update public.tenant_message_templates
set content = replace(content, 'Assistente Jack', 'Assistente João'),
    updated_at = now()
where content like '%Assistente Jack%';

comment on function public.admin_ensure_tenant_whatsapp_entry_link(uuid) is
  'Returns the active legacy link or creates a new neutral mav-* tenant entry link.';
