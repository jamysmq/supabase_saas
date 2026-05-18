import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parsePriceCents(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }

  const amountCents = parseMoneyToCents(value)

  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return NaN
  }

  return amountCents
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serviceId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { serviceId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const description = String(body?.description ?? '').trim() || null
  const durationMinutes = Number(body?.duration_minutes ?? 60)
  const priceCents = parsePriceCents(body?.price ?? body?.price_cents)

  if (!name) {
    return errorResponse('Informe o nome do serviço.')
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return errorResponse('Duração inválida. Informe entre 15 e 480 minutos.')
  }

  if (Number.isNaN(priceCents)) {
    return errorResponse('Valor inválido. Informe um valor maior ou igual a zero.')
  }

  const { data, error } = await result.supabase
    .from('tenant_services')
    .update({
      name,
      description,
      duration_minutes: durationMinutes,
      price_cents: priceCents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serviceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível atualizar o serviço.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ serviceId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { serviceId } = await context.params

  const { data, error } = await result.supabase
    .from('tenant_services')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', serviceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível excluir o serviço.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}
