import {
  requireTenantUser,
  tenantCanUseResourceBookingPlus,
} from '../../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ resourceId: string }> }
) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseResourceBookingPlus(result.tenant)) {
    return errorResponse('O Plus Quadras e ambientes não está ativo para este negócio.', 403)
  }

  const { resourceId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const kind = body?.kind === 'environment' ? 'environment' : 'court'
  const description = String(body?.description ?? '').trim() || null
  const durationMinutes = Number(body?.duration_minutes)
  const priceCents = body?.price === undefined || String(body.price).trim() === ''
    ? null
    : parseMoneyToCents(body.price)

  if (!name) return errorResponse('Informe o nome da quadra ou ambiente.')
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return errorResponse('Duração inválida. Informe entre 15 e 480 minutos.')
  }
  if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
    return errorResponse('Valor inválido. Informe um valor maior ou igual a zero.')
  }

  const { data, error } = await result.supabase
    .from('tenant_bookable_resources')
    .update({
      name,
      kind,
      description,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', resourceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .select('id, name, kind, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .maybeSingle()

  if (error) return errorResponse('Não foi possível atualizar a quadra ou ambiente.', 500, error.message)
  if (!data) return errorResponse('Quadra ou ambiente não encontrado.', 404)
  return Response.json({ resource: data })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resourceId: string }> }
) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseResourceBookingPlus(result.tenant)) {
    return errorResponse('O Plus Quadras e ambientes não está ativo para este negócio.', 403)
  }

  const { resourceId } = await context.params
  const { count, error: countError } = await result.supabase
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('bookable_resource_id', resourceId)
    .in('status', ['scheduled', 'confirmed'])
    .is('deleted_at', null)
    .gt('ends_at', new Date().toISOString())

  if (countError) return errorResponse('Não foi possível validar reservas futuras.', 500, countError.message)
  if ((count ?? 0) > 0) {
    return errorResponse('Este local possui reservas futuras. Cancele ou remaneje antes de excluí-lo.', 409)
  }

  const { data, error } = await result.supabase
    .from('tenant_bookable_resources')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', resourceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .select('id')
    .maybeSingle()

  if (error) return errorResponse('Não foi possível excluir a quadra ou ambiente.', 500, error.message)
  if (!data) return errorResponse('Quadra ou ambiente não encontrado.', 404)
  return Response.json({ ok: true })
}
