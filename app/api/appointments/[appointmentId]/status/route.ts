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
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { appointmentId } = await context.params
  const body = await request.json().catch(() => null)
  const status = String(body?.status ?? '').trim()

  if (!allowedStatuses.has(status)) {
    return errorResponse('Status de agendamento invalido.')
  }

  const { data: appointment, error: appointmentError } = await result.supabase
    .from('appointments')
    .select('id, status, cancelled_at')
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (appointmentError || !appointment) {
    return errorResponse('Agendamento nao encontrado.', 404, appointmentError?.message)
  }

  const { error } = await result.supabase
    .from('appointments')
    .update({
      status,
      cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error) {
    return errorResponse('Nao foi possivel atualizar o status.', 500, error.message)
  }

  if (appointment.status !== status) {
    const { error: eventError } = await result.supabase
      .from('appointment_status_events')
      .insert({
        appointment_id: appointmentId,
        tenant_id: result.tenantUser.tenant_id,
        tenant_user_id: result.tenantUser.id,
        old_status: appointment.status,
        new_status: status,
        source: 'panel',
      })

    if (eventError) {
      console.error('Nao foi possivel registrar historico de status do agendamento.', eventError.message)
    }
  }

  return Response.json({ ok: true })
}
