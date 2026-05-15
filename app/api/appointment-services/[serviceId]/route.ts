import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serviceId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { serviceId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()

  if (!name) {
    return errorResponse('Informe o nome do servico.')
  }

  const { data, error } = await result.supabase
    .from('tenant_services')
    .update({
      name,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serviceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel atualizar o servico.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ serviceId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { serviceId } = await context.params

  const { data, error } = await result.supabase
    .from('tenant_services')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serviceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel excluir o servico.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}
