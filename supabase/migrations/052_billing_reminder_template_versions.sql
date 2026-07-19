-- Switches billing reminders to the Meta-approved wording revisions while
-- preserving the delivery, idempotency and retry behavior from migrations 050/051.

do $migration$
declare
  v_list_definition text;
  v_reserve_definition text;
begin
  select pg_get_functiondef(
    'public.admin_list_due_cycles_for_date(date)'::regprocedure
  ) into v_list_definition;

  if v_list_definition not like '%jack_billing_due_reminder_v2%'
     or v_list_definition not like '%jack_billing_overdue_reminder_v1%' then
    raise exception 'unexpected_admin_list_due_cycles_template_versions';
  end if;

  execute replace(
    replace(
      v_list_definition,
      'jack_billing_due_reminder_v2',
      'jack_billing_due_reminder_v3'
    ),
    'jack_billing_overdue_reminder_v1',
    'jack_billing_overdue_reminder_v2'
  );

  select pg_get_functiondef(
    'public.admin_reserve_billing_reminder_attempt(uuid,text,text,text,text,date)'::regprocedure
  ) into v_reserve_definition;

  if v_reserve_definition not like '%jack_billing_due_reminder_v2%'
     or v_reserve_definition not like '%jack_billing_overdue_reminder_v1%' then
    raise exception 'unexpected_admin_reserve_billing_template_versions';
  end if;

  execute replace(
    replace(
      v_reserve_definition,
      'jack_billing_due_reminder_v2',
      'jack_billing_due_reminder_v3'
    ),
    'jack_billing_overdue_reminder_v1',
    'jack_billing_overdue_reminder_v2'
  );
end
$migration$;

do $validation$
declare
  v_list_definition text;
  v_reserve_definition text;
begin
  select pg_get_functiondef(
    'public.admin_list_due_cycles_for_date(date)'::regprocedure
  ) into v_list_definition;
  select pg_get_functiondef(
    'public.admin_reserve_billing_reminder_attempt(uuid,text,text,text,text,date)'::regprocedure
  ) into v_reserve_definition;

  if v_list_definition not like '%jack_billing_due_reminder_v3%'
     or v_list_definition not like '%jack_billing_overdue_reminder_v2%'
     or v_list_definition like '%jack_billing_due_reminder_v2%'
     or v_list_definition like '%jack_billing_overdue_reminder_v1%' then
    raise exception 'admin_list_due_cycles_template_rollout_failed';
  end if;

  if v_reserve_definition not like '%jack_billing_due_reminder_v3%'
     or v_reserve_definition not like '%jack_billing_overdue_reminder_v2%'
     or v_reserve_definition like '%jack_billing_due_reminder_v2%'
     or v_reserve_definition like '%jack_billing_overdue_reminder_v1%' then
    raise exception 'admin_reserve_billing_template_rollout_failed';
  end if;
end
$validation$;
