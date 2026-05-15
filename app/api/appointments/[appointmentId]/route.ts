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
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { appointmentId } = await context.params
  const deletedAt = new Date().toISOString()

  const { data: appointment, error: appointmentError } = await result.supabase
    .from('appointments')
    .select('id, status')
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (appointmentError || !appointment) {
    return errorResponse('Agendamento nao encontrado.', 404, appointmentError?.message)
  }

  const { error } = await result.supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: deletedAt,
      deleted_at: deletedAt,
      updated_at: deletedAt,
    })
    .eq('id', appointmentId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error) {
    return errorResponse('Nao foi possivel excluir o agendamento.', 500, error.message)
  }

  const { error: eventError } = await result.supabase
    .from('appointment_status_events')
    .insert({
      appointment_id: appointmentId,
      tenant_id: result.tenantUser.tenant_id,
      tenant_user_id: result.tenantUser.id,
      old_status: appointment.status,
      new_status: 'cancelled',
      source: 'panel_delete',
      note: 'Agendamento excluido pelo painel.',
    })

  if (eventError) {
    console.error('Nao foi possivel registrar historico de exclusao do agendamento.', eventError.message)
  }

  return Response.json({ ok: true })
}
