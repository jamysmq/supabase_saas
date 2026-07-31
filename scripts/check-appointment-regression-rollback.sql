-- Production-safe appointment regression. Every synthetic row is rolled back.
begin;

do $$
declare
  v_service_tenant_id uuid;
  v_service_id uuid;
  v_staff_id uuid;
  v_resource_tenant_id uuid;
  v_resource_id uuid;
  v_resource_default_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_first_start timestamptz;
  v_first_end timestamptz;
  v_second_start timestamptz;
  v_second_end timestamptz;
  v_appointment_1 uuid;
  v_appointment_2 uuid;
  v_appointment_3 uuid;
  v_appointment_4 uuid;
  v_resource_appointment uuid;
  v_customer_count integer;
  v_duration integer;
begin
  select link.tenant_id, link.service_id, link.staff_member_id
    into v_service_tenant_id, v_service_id, v_staff_id
  from public.tenant_service_staff_members link
  join public.tenants tenant
    on tenant.id = link.tenant_id
   and tenant.status = 'active'
   and tenant.plan in ('plan2', 'plan3')
  join public.tenant_services service
    on service.id = link.service_id
   and service.tenant_id = link.tenant_id
   and service.is_active = true
  join public.tenant_staff_members staff
    on staff.id = link.staff_member_id
   and staff.tenant_id = link.tenant_id
   and staff.is_active = true
  order by (tenant.public_name = 'Dr. Bosco') desc, tenant.created_at desc
  limit 1;

  if v_service_tenant_id is null then
    raise exception 'regression_setup_missing_service_and_staff';
  end if;

  select slot.starts_at, slot.ends_at
    into v_start, v_end
  from public.wa_appointment_suggest_slots(
    v_service_tenant_id, v_service_id, v_staff_id,
    current_date, null, 1, 0, 60, 'America/Fortaleza'
  ) slot
  limit 1;

  if v_start is null then
    raise exception 'regression_setup_missing_service_slot';
  end if;

  v_appointment_1 := public.wa_appointment_create_external(
    v_service_tenant_id, 'Regressao Sem CPF Um', null, '559999000001', date '1990-01-01',
    v_service_id, v_staff_id, v_start, v_end, 'Regressao agenda', 'Rollback automatico'
  );
  v_first_start := v_start;
  v_first_end := v_end;

  select slot.starts_at, slot.ends_at
    into v_start, v_end
  from public.wa_appointment_suggest_slots(
    v_service_tenant_id, v_service_id, v_staff_id,
    current_date, null, 1, 0, 60, 'America/Fortaleza'
  ) slot
  limit 1;

  v_appointment_2 := public.wa_appointment_create_external(
    v_service_tenant_id, 'Regressao Sem CPF Dois', '', '559999000002', date '1991-02-02',
    v_service_id, v_staff_id, v_start, v_end, 'Regressao agenda', 'Rollback automatico'
  );
  v_second_start := v_start;
  v_second_end := v_end;

  select count(*)
    into v_customer_count
  from public.end_customers customer
  where customer.tenant_id = v_service_tenant_id
    and customer.whatsapp_e164 in ('559999000001', '559999000002');

  if v_customer_count <> 2 then
    raise exception 'optional_cpf_did_not_create_two_customers: %', v_customer_count;
  end if;

  select slot.starts_at, slot.ends_at
    into v_start, v_end
  from public.wa_appointment_suggest_slots(
    v_service_tenant_id, v_service_id, v_staff_id,
    current_date, null, 1, 0, 60, 'America/Fortaleza'
  ) slot
  limit 1;

  v_appointment_3 := public.wa_appointment_create_external(
    v_service_tenant_id, 'Regressao CPF Formatado', '900.000.000-01', '559999000003', date '1992-03-03',
    v_service_id, v_staff_id, v_start, v_end, 'Regressao agenda', 'Rollback automatico'
  );

  select slot.starts_at, slot.ends_at
    into v_start, v_end
  from public.wa_appointment_suggest_slots(
    v_service_tenant_id, v_service_id, v_staff_id,
    current_date, null, 1, 0, 60, 'America/Fortaleza'
  ) slot
  limit 1;

  v_appointment_4 := public.wa_appointment_create_external(
    v_service_tenant_id, 'Regressao CPF Formatado Atualizado', '90000000001', '559999000004', date '1992-03-03',
    v_service_id, v_staff_id, v_start, v_end, 'Regressao agenda', 'Rollback automatico'
  );

  select count(*)
    into v_customer_count
  from public.end_customers customer
  where customer.tenant_id = v_service_tenant_id
    and customer.cpf = '90000000001';

  if v_customer_count <> 1 then
    raise exception 'formatted_cpf_was_not_reused: %', v_customer_count;
  end if;

  begin
    perform public.upsert_external_appointment_customer(
      v_service_tenant_id, 'Regressao CPF Invalido', '123', '559999000005', date '1993-04-04'
    );
    raise exception 'expected_invalid_customer_cpf';
  exception when others then
    if sqlerrm = 'expected_invalid_customer_cpf'
       or position('invalid_customer_cpf' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  perform public.wa_appointment_apply_customer_action(
    v_appointment_1, 'confirm', null, null, 'Regressao: confirmacao'
  );
  perform public.wa_appointment_apply_customer_action(
    v_appointment_2, 'cancel', null, null, 'Regressao: cancelamento'
  );
  perform public.wa_appointment_apply_customer_action(
    v_appointment_1, 'reschedule', v_second_start, v_second_end, 'Regressao: remarcacao'
  );

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = v_appointment_1
      and appointment.status = 'scheduled'
      and appointment.starts_at = v_second_start
      and appointment.ends_at = v_second_end
  ) then
    raise exception 'reschedule_result_invalid';
  end if;

  if not exists (
    select 1 from public.appointments appointment
    where appointment.id = v_appointment_2 and appointment.status = 'cancelled'
  ) then
    raise exception 'cancel_result_invalid';
  end if;

  begin
    perform public.wa_appointment_create_external(
      v_service_tenant_id, 'Regressao Conflito', null, '559999000006', date '1994-05-05',
      v_service_id, v_staff_id, v_second_start, v_second_end, 'Regressao conflito', null
    );
    raise exception 'expected_appointment_time_unavailable';
  exception when others then
    if sqlerrm = 'expected_appointment_time_unavailable'
       or position('appointment_time_unavailable' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  select resource.tenant_id, resource.id, resource.duration_minutes
    into v_resource_tenant_id, v_resource_id, v_resource_default_duration
  from public.tenant_bookable_resources resource
  join public.tenants tenant
    on tenant.id = resource.tenant_id
   and tenant.status = 'active'
   and tenant.plan = 'plan3'
   and tenant.resource_booking_plus_enabled = true
  where resource.is_active = true
  order by (tenant.public_name = 'Arena do BT') desc, tenant.created_at desc
  limit 1;

  if v_resource_tenant_id is null then
    raise exception 'regression_setup_missing_resource';
  end if;

  v_duration := ceil(v_resource_default_duration / 30.0)::integer * 30;
  while v_duration <= 240 loop
    if not exists (
      select 1
      from public.wa_appointment_suggest_resource_slots(
        v_resource_tenant_id, v_resource_id, current_date, null,
        1, 0, 60, 'America/Fortaleza', v_duration
      ) slot
      where slot.duration_minutes = v_duration
        and slot.ends_at - slot.starts_at = make_interval(mins => v_duration)
    ) then
      raise exception 'resource_duration_without_slot: %', v_duration;
    end if;
    v_duration := v_duration + 30;
  end loop;

  select slot.starts_at, slot.ends_at
    into v_start, v_end
  from public.wa_appointment_suggest_resource_slots(
    v_resource_tenant_id, v_resource_id, current_date, null,
    1, 0, 60, 'America/Fortaleza', 240
  ) slot
  limit 1;

  v_resource_appointment := public.wa_appointment_create_resource_external(
    v_resource_tenant_id, 'Regressao Ambiente', null, '559999000007', date '1995-06-06',
    v_resource_id, v_start, v_end, 'Regressao ambiente', 'Rollback automatico'
  );

  begin
    perform public.wa_appointment_create_resource_external(
      v_resource_tenant_id, 'Regressao Conflito Ambiente', null, '559999000008', date '1996-07-07',
      v_resource_id, v_start, v_end, 'Regressao conflito ambiente', null
    );
    raise exception 'expected_bookable_resource_time_unavailable';
  exception when others then
    if sqlerrm = 'expected_bookable_resource_time_unavailable'
       or position('bookable_resource_time_unavailable' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  if (select count(*) from public.appointment_status_events event
      where event.appointment_id = v_appointment_1) < 3 then
    raise exception 'appointment_status_audit_incomplete';
  end if;

  raise notice 'Appointment regression passed; all synthetic data will be rolled back.';
end;
$$;

rollback;
