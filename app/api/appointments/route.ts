import {
  requireTenantUser,
  tenantCanUseAppointments,
  tenantCanUseResourceBookingPlus,
} from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function normalizeBrazilWhatsapp(value: string) {
  const digits = value.replace(/\D/g, '')

  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }

  return digits
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (!from || !to) {
    return errorResponse('Período da agenda é obrigatório.')
  }

  const { data, error } = await result.supabase.rpc('admin_list_appointments', {
    p_tenant_id: result.tenantUser.tenant_id,
    p_starts_from: from,
    p_starts_to: to,
  })

  if (error) {
    return errorResponse('Não foi possível listar agendamentos.', 500, error.message)
  }

  const appointments = data ?? []
  const appointmentIds = appointments.map(
    (appointment: { appointment_id: string }) => appointment.appointment_id
  )
  let resourceByAppointmentId = new Map<string, {
    bookable_resource_id: string | null
    bookable_resource_name: string | null
  }>()

  if (appointmentIds.length > 0) {
    const { data: resourceAppointments, error: resourceError } = await result.supabase
      .from('appointments')
      .select('id, bookable_resource_id, bookable_resource_name_snapshot, tenant_bookable_resources(name)')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .in('id', appointmentIds)

    if (resourceError) {
      return errorResponse('Não foi possível carregar os locais dos agendamentos.', 500, resourceError.message)
    }

    resourceByAppointmentId = new Map((resourceAppointments ?? []).map((appointment) => {
      const relation = appointment.tenant_bookable_resources as unknown as { name?: string } | null
      return [appointment.id, {
        bookable_resource_id: appointment.bookable_resource_id,
        bookable_resource_name: appointment.bookable_resource_name_snapshot || relation?.name || null,
      }]
    }))
  }

  return Response.json({
    appointments: appointments.map((appointment: { appointment_id: string }) => ({
      ...appointment,
      ...(resourceByAppointmentId.get(appointment.appointment_id) ?? {
        bookable_resource_id: null,
        bookable_resource_name: null,
      }),
    })),
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const body = await request.json().catch(() => null)
  const startsAt = String(body?.starts_at ?? '').trim()
  const endsAt = String(body?.ends_at ?? '').trim()
  const title = String(body?.title ?? '').trim() || null
  const notes = String(body?.notes ?? '').trim() || null
  const fullName = String(body?.full_name ?? '').trim()
  const cpf = String(body?.cpf ?? '').replace(/\D/g, '')
  const whatsapp = normalizeBrazilWhatsapp(String(body?.whatsapp_e164 ?? ''))
  const birthDate = String(body?.birth_date ?? '').trim()
  const serviceId = String(body?.service_id ?? '').trim() || null
  const staffMemberId = String(body?.staff_member_id ?? '').trim() || null
  const bookableResourceId = String(body?.bookable_resource_id ?? '').trim() || null

  if (!fullName) {
    return errorResponse('Informe o nome completo.')
  }

  if (cpf.length !== 11) {
    return errorResponse('CPF inválido. Informe 11 dígitos.')
  }

  if (whatsapp.length < 12 || whatsapp.length > 13 || !whatsapp.startsWith('55')) {
    return errorResponse('WhatsApp inválido. Informe DDD e número, por exemplo 83999999999.')
  }

  if (!birthDate) {
    return errorResponse('Informe a data de nascimento.')
  }

  if (!bookableResourceId && !serviceId) {
    return errorResponse('Informe o servico.')
  }

  if (!bookableResourceId && !staffMemberId) {
    return errorResponse('Informe o profissional.')
  }

  if (bookableResourceId && (serviceId || staffMemberId)) {
    return errorResponse('Escolha um serviço/profissional ou uma quadra/ambiente, não os dois.')
  }

  if (!startsAt || !endsAt) {
    return errorResponse('Informe início e fim do agendamento.')
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return errorResponse('O fim precisa ser depois do início.')
  }

  if (bookableResourceId) {
    if (!tenantCanUseResourceBookingPlus(result.tenant)) {
      return errorResponse('O Plus Quadras e ambientes não está ativo para este negócio.', 403)
    }

    const { data, error } = await result.supabase.rpc('admin_create_external_resource_appointment', {
      p_tenant_id: result.tenantUser.tenant_id,
      p_full_name: fullName,
      p_cpf: cpf,
      p_whatsapp_e164: whatsapp,
      p_birth_date: birthDate,
      p_bookable_resource_id: bookableResourceId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_title: title,
      p_notes: notes,
      p_source: 'panel',
    })

    if (error) {
      if (error.message.includes('bookable_resource_time_unavailable')) {
        return errorResponse('Esse horário já está reservado para este local.', 409)
      }
      return errorResponse('Não foi possível criar o aluguel.', 500, error.message)
    }

    return Response.json({ appointment_id: data })
  }

  const { data: serviceStaffLink, error: serviceStaffLinkError } = await result.supabase
    .from('tenant_service_staff_members')
    .select('service_id')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('service_id', serviceId)
    .eq('staff_member_id', staffMemberId)
    .maybeSingle()

  if (serviceStaffLinkError) {
    return errorResponse('Nao foi possivel validar servico e profissional.', 500, serviceStaffLinkError.message)
  }

  if (!serviceStaffLink) {
    return errorResponse('Este profissional nao esta vinculado ao servico selecionado.')
  }

  const { data, error } = await result.supabase.rpc('admin_create_external_appointment', {
    p_tenant_id: result.tenantUser.tenant_id,
    p_full_name: fullName,
    p_cpf: cpf,
    p_whatsapp_e164: whatsapp,
    p_birth_date: birthDate,
    p_service_id: serviceId,
    p_staff_member_id: staffMemberId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_title: title,
    p_notes: notes,
    p_source: 'panel',
  })

  if (error) {
    if (error.message.includes('appointment_time_unavailable')) {
      return errorResponse('Esse horario esta ocupado ou bloqueado na agenda.', 409)
    }
    return errorResponse('Não foi possível criar o agendamento.', 500, error.message)
  }

  return Response.json({ appointment_id: data })
}
