import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Clientes e grupos disponíveis apenas em planos com cobrança mensal.', 403)
  }

  const { data: groups, error } = await result.supabase
    .from('tenant_customer_groups')
    .select('id, name, description, max_members, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível listar os grupos.', 500, error.message)
  }

  const { data: customers, error: customersError } = await result.supabase
    .from('tenant_customers')
    .select('group_id')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .not('group_id', 'is', null)

  if (customersError) {
    return errorResponse('Não foi possível contar os clientes dos grupos.', 500, customersError.message)
  }

  const counts = new Map<string, number>()

  for (const customer of customers ?? []) {
    if (customer.group_id) {
      counts.set(customer.group_id, (counts.get(customer.group_id) ?? 0) + 1)
    }
  }

  return Response.json({
    groups: (groups ?? []).map((group) => ({
      ...group,
      active_customers_count: counts.get(group.id) ?? 0,
    })),
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Clientes e grupos disponíveis apenas em planos com cobrança mensal.', 403)
  }

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

  const { data: group, error: groupError } = await result.supabase
    .from('tenant_customer_groups')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      description,
      max_members: maxMembers,
      is_active: true,
    })
    .select('id, name, description, max_members, is_active, created_at, updated_at')
    .single()

  if (groupError) {
    return errorResponse('Não foi possível criar o grupo.', 500, groupError.message)
  }

  return Response.json({ group })
}
