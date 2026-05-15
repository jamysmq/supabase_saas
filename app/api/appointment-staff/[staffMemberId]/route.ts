import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ staffMemberId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { staffMemberId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const role = String(body?.role ?? body?.notes ?? '').trim() || null

  if (!name) {
    return errorResponse('Informe o nome do profissional.')
  }

  const { data, error } = await result.supabase
    .from('tenant_staff_members')
    .update({
      name,
      role,
      updated_at: new Date().toISOString(),
    })
    .eq('id', staffMemberId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel atualizar o profissional.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ staffMemberId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { staffMemberId } = await context.params

  const { data, error } = await result.supabase
    .from('tenant_staff_members')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', staffMemberId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel excluir o profissional.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}
