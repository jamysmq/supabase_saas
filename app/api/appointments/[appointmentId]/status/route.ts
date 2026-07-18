import { requireTenantUser, tenantCanUseAppointments } from '../../../../../src/lib/tenant-admin'

const allowedStatuses = new Set(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { appointmentId } = await context.params
  const body = await request.json().catch(() => null)
  const status = String(body?.status ?? '').trim()

  if (!allowedStatuses.has(status)) {
    return errorResponse('Status de agendamento inválido.')
  }

  const { error } = await result.supabase.rpc('admin_update_appointment_outcome', {
    p_tenant_id: result.tenantUser.tenant_id,
    p_appointment_id: appointmentId,
    p_tenant_user_id: result.tenantUser.id,
    p_status: status,
    p_source: 'panel',
  })

  if (error) {
    if (error.message.includes('appointment_not_found')) {
      return errorResponse('Agendamento não encontrado.', 404)
    }

    if (error.message.includes('appointment_has_not_ended')) {
      return errorResponse(
        'O atendimento só pode ser marcado como concluído ou faltou depois do horário final.',
        409
      )
    }

    if (error.message.includes('appointment_day_unavailable')) {
      return errorResponse(
        'Este dia não faz parte do expediente atual. Ajuste os dias de atendimento antes de remarcar o horário.',
        409
      )
    }

    return errorResponse('Não foi possível atualizar o status.', 500, error.message)
  }

  return Response.json({ ok: true })
}
