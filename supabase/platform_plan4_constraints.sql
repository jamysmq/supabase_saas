do $$
declare
  v_constraint_name text;
begin
  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'subscriptions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%plan%'
  loop
    execute format('alter table public.subscriptions drop constraint if exists %I', v_constraint_name);
  end loop;

  for v_constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'tenants'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%business_type%'
  loop
    execute format('alter table public.tenants drop constraint if exists %I', v_constraint_name);
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_plan_check
  check (plan in ('plan1', 'plan2', 'plan3', 'plan4'));

alter table public.tenants
  add constraint tenants_business_type_check
  check (business_type in ('teacher', 'autonomous', 'clinic', 'salon', 'restaurant'));
