import { requireTenantUser } from '../../../../../src/lib/tenant-admin'

const allowedStatuses = new Set(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'])

function errorResponse(message: string, status = 400, details?: string) {
  return Response.json({ error: message, message, details }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { appointmentId } = await context.params
  const body = await request.json().catch(() => null)
  const status = String(body?.status ?? '').trim()

  if (!allowedStatuses.has(status)) {
    return errorResponse('Status de agendamento invalido.')
  }

  const { data: appointment, error: appointmentError } = await result.supabase
    .from('appointments')
    .select('id')
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (appointmentError || !appointment) {
    return errorResponse('Agendamento nao encontrado.', 404, appointmentError?.message)
  }

  const { error } = await result.supabase.rpc('admin_update_appointment_status', {
    p_appointment_id: appointmentId,
    p_status: status,
  })

  if (error) {
    return errorResponse('Nao foi possivel atualizar o status.', 500, error.message)
  }

  return Response.json({ ok: true })
}
