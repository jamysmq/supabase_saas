import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function dateParamToIso(value: string | null, fallback: Date) {
  if (!value) return fallback.toISOString()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString()
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Histórico de agendamentos disponível apenas em planos com agenda.', 403)
  }

  const url = new URL(request.url)
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 30)
  defaultFrom.setHours(0, 0, 0, 0)

  const defaultTo = new Date(now)
  defaultTo.setDate(defaultTo.getDate() + 1)
  defaultTo.setHours(0, 0, 0, 0)

  const from = dateParamToIso(url.searchParams.get('from'), defaultFrom)
  const to = dateParamToIso(url.searchParams.get('to'), defaultTo)
  const status = String(url.searchParams.get('status') ?? '').trim() || null

  if (new Date(to).getTime() <= new Date(from).getTime()) {
    return errorResponse('Período inválido.')
  }

  const { data, error } = await result.supabase.rpc('admin_list_appointment_history', {
    p_tenant_id: result.tenantUser.tenant_id,
    p_starts_from: from,
    p_starts_to: to,
    p_status: status,
  })

  if (error) {
    return errorResponse('Não foi possível carregar o histórico de agendamentos.', 500, error.message)
  }

  return Response.json({ appointments: data ?? [] })
}
