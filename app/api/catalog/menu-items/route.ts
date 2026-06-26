import { requireTenantUser, tenantCanUseRestaurant } from '../../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parsePriceCents(value: unknown) {
  const amountCents = parseMoneyToCents(value)

  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return NaN
  }

  return amountCents
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_menu_items')
    .select('id, group_id, name, description, price_cents, currency, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível listar o cardápio.', 500, error.message)
  }

  return Response.json({ items: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Cardápio disponível apenas no plano restaurante.', 403)
  }

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const description = String(body?.description ?? '').trim() || null
  const groupId = String(body?.group_id ?? '').trim() || null
  const priceCents = parsePriceCents(body?.price ?? body?.price_cents)

  if (!name) {
    return errorResponse('Informe o nome do item.')
  }

  if (Number.isNaN(priceCents)) {
    return errorResponse('Valor inválido. Informe um valor maior ou igual a zero.')
  }

  if (groupId) {
    const { data: group, error: groupError } = await result.supabase
      .from('tenant_menu_groups')
      .select('id')
      .eq('id', groupId)
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .maybeSingle()

    if (groupError || !group) {
      return errorResponse('Grupo de cardápio inválido.', 400, groupError?.message)
    }
  }

  const { data, error } = await result.supabase
    .from('tenant_menu_items')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      group_id: groupId,
      name,
      description,
      price_cents: priceCents,
      is_active: true,
    })
    .select('id, group_id, name, description, price_cents, currency, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível criar o item.', 500, error?.message)
  }

  return Response.json({ item: data })
}
