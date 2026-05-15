import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

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
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  if (!from || !to) {
    return errorResponse('Periodo da agenda e obrigatorio.')
  }

  const { data, error } = await result.supabase.rpc('admin_list_appointments', {
    p_tenant_id: result.tenantUser.tenant_id,
    p_starts_from: from,
    p_starts_to: to,
  })

  if (error) {
    return errorResponse('Nao foi possivel listar agendamentos.', 500, error.message)
  }

  return Response.json({ appointments: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
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

  if (!fullName) {
    return errorResponse('Informe o nome completo.')
  }

  if (cpf.length !== 11) {
    return errorResponse('CPF invalido. Informe 11 digitos.')
  }

  if (whatsapp.length < 12 || whatsapp.length > 13 || !whatsapp.startsWith('55')) {
    return errorResponse('WhatsApp invalido. Informe DDD e numero, por exemplo 83999999999.')
  }

  if (!birthDate) {
    return errorResponse('Informe a data de nascimento.')
  }

  if (!startsAt || !endsAt) {
    return errorResponse('Informe inicio e fim do agendamento.')
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return errorResponse('O fim precisa ser depois do inicio.')
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
    return errorResponse('Nao foi possivel criar o agendamento.', 500, error.message)
  }

  return Response.json({ appointment_id: data })
}
