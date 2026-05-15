import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

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

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()

  if (!name) {
    return errorResponse('Informe o nome do servico.')
  }

  const { data, error } = await result.supabase
    .from('tenant_services')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      duration_minutes: 60,
      is_active: true,
    })
    .select('id, name, description, duration_minutes, price_cents, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel criar o servico.', 500, error?.message)
  }

  return Response.json({ service: data })
}
