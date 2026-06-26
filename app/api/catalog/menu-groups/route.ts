import { requireTenantUser, tenantCanUseRestaurant } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_menu_groups')
    .select('id, name, sort_order, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível listar os grupos.', 500, error.message)
  }

  return Response.json({ groups: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

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
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      sort_order: sortOrder,
      is_active: true,
    })
    .select('id, name, sort_order, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível criar o grupo.', 500, error?.message)
  }

  return Response.json({ group: data })
}
