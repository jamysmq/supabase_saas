import { requireTenantUser } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  return Response.json({ error: message, message, details }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase
    .from('tenant_services')
    .select('id, name, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Nao foi possivel listar os servicos.', 500, error.message)
  }

  return Response.json({ services: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const description = String(body?.description ?? '').trim() || null
  const durationMinutes = Number(body?.duration_minutes ?? 60)
  const priceCents = body?.price ? Math.round(Number(String(body.price).replace(',', '.')) * 100) : null

  if (!name) {
    return errorResponse('Informe o nome do servico.')
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return errorResponse('Duracao invalida.')
  }

  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
    return errorResponse('Valor invalido.')
  }

  const { data, error } = await result.supabase
    .from('tenant_services')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      description,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      is_active: true,
    })
    .select('id, name, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel criar o servico.', 500, error?.message)
  }

  return Response.json({ service: data })
}
