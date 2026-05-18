import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../src/lib/money'

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

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_services')
    .select('id, name, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível listar os serviços.', 500, error.message)
  }

  return Response.json({ services: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

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
    return errorResponse('Não foi possível criar o serviço.', 500, error?.message)
  }

  return Response.json({ service: data })
}
