import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ appointmentId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { appointmentId } = await context.params
  const { data, error } = await result.supabase
    .from('appointments')
    .delete()
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse(
      'Não foi possível excluir o agendamento.',
      error?.code === 'PGRST116' ? 404 : 500,
      error?.message
    )
  }

  return Response.json({ ok: true })
}
