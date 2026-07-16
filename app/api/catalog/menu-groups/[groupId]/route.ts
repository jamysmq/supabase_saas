import { requireTenantUser, tenantCanUseRestaurant } from '../../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

  const { groupId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const sortOrder = Number(body?.sort_order ?? 0)

  if (!name) {
    return errorResponse('Informe o nome do grupo.')
  }

  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
    return errorResponse('Ordem inválida.')
  }

  const { data, error } = await result.supabase
    .from('tenant_menu_groups')
    .update({
      name,
      sort_order: sortOrder,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível atualizar o grupo.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

  const { groupId } = await context.params

  const { data, error } = await result.supabase
    .from('tenant_menu_groups')
    .delete()
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível excluir o grupo.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  await result.supabase
    .from('tenant_menu_items')
    .update({
      group_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('group_id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)

  return Response.json({ ok: true })
}
