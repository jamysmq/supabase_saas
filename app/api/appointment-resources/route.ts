import {
  requireTenantUser,
  tenantCanUseResourceBookingPlus,
} from '../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function parsePrice(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  return parseMoneyToCents(value)
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseResourceBookingPlus(result.tenant)) {
    return errorResponse('O Plus Quadras e ambientes não está ativo para este negócio.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_bookable_resources')
    .select('id, name, kind, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name')

  if (error) return errorResponse('Não foi possível listar quadras e ambientes.', 500, error.message)
  return Response.json({ resources: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseResourceBookingPlus(result.tenant)) {
    return errorResponse('O Plus Quadras e ambientes não está ativo para este negócio.', 403)
  }

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const kind = body?.kind === 'environment' ? 'environment' : 'court'
  const description = String(body?.description ?? '').trim() || null
  const durationMinutes = Number(body?.duration_minutes)
  const priceCents = parsePrice(body?.price ?? body?.price_cents)

  if (!name) return errorResponse('Informe o nome da quadra ou ambiente.')
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return errorResponse('Duração inválida. Informe entre 15 e 480 minutos.')
  }
  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
    return errorResponse('Valor inválido. Informe um valor maior ou igual a zero.')
  }

  const { data, error } = await result.supabase
    .from('tenant_bookable_resources')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      kind,
      description,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      is_active: true,
    })
    .select('id, name, kind, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .single()

  if (error || !data) return errorResponse('Não foi possível criar a quadra ou ambiente.', 500, error?.message)
  return Response.json({ resource: data })
}
