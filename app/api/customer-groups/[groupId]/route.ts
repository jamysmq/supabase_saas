import { requireTenantUser, tenantCanUseBilling } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Clientes e grupos disponiveis apenas em planos com cobranca mensal.', 403)
  }

  const { groupId } = await context.params
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string'
    ? body.description.trim() || null
    : null

  if (!name) {
    return errorResponse('Group name is required.')
  }

  const { data: group, error } = await result.supabase
    .from('tenant_customer_groups')
    .update({
      name,
      description,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .select('id, name, description, is_active, created_at, updated_at')
    .single()

  if (error || !group) {
    return errorResponse('Could not update group.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ group })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Clientes e grupos disponiveis apenas em planos com cobranca mensal.', 403)
  }

  const { groupId } = await context.params

  const { error: unlinkError } = await result.supabase
    .from('tenant_customers')
    .update({
      group_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('group_id', groupId)

  if (unlinkError) {
    return errorResponse('Could not unlink customers.', 500, unlinkError.message)
  }

  const { error: groupError } = await result.supabase
    .from('tenant_customer_groups')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)

  if (groupError) {
    return errorResponse('Could not delete group.', 500, groupError.message)
  }

  return Response.json({ ok: true })
}
