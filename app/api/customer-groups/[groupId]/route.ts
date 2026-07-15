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
    return errorResponse('Clientes e grupos disponíveis apenas em planos com cobrança mensal.', 403)
  }

  const { groupId } = await context.params
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string'
    ? body.description.trim() || null
    : null
  const maxMembers = body?.max_members === null || body?.max_members === '' || body?.max_members === undefined
    ? null
    : Number(body.max_members)

  if (!name) {
    return errorResponse('Informe o nome do grupo.')
  }

  if (maxMembers !== null && (!Number.isInteger(maxMembers) || maxMembers < 1)) {
    return errorResponse('A capacidade deve ser um número inteiro maior que zero.')
  }

  const { count: currentMembers, error: countError } = await result.supabase
    .from('tenant_customers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('group_id', groupId)
    .eq('is_active', true)

  if (countError) {
    return errorResponse('Não foi possível validar a ocupação do grupo.', 500, countError.message)
  }

  if (maxMembers !== null && maxMembers < (currentMembers ?? 0)) {
    return errorResponse(`A capacidade não pode ser menor que os ${currentMembers ?? 0} alunos ativos desta turma.`)
  }

  const { data: group, error } = await result.supabase
    .from('tenant_customer_groups')
    .update({
      name,
      description,
      max_members: maxMembers,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .select('id, name, description, max_members, is_active, created_at, updated_at')
    .single()

  if (error || !group) {
    return errorResponse('Não foi possível atualizar o grupo.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
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
    return errorResponse('Clientes e grupos disponíveis apenas em planos com cobrança mensal.', 403)
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
    return errorResponse('Não foi possível desvincular os clientes do grupo.', 500, unlinkError.message)
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
    return errorResponse('Não foi possível excluir o grupo.', 500, groupError.message)
  }

  return Response.json({ ok: true })
}
