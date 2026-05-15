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
    .from('tenant_staff_members')
    .select('id, name, role, phone_e164, email, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Nao foi possivel listar profissionais.', 500, error.message)
  }

  return Response.json({ staff: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const role = String(body?.role ?? body?.notes ?? '').trim() || null

  if (!name) {
    return errorResponse('Informe o nome do profissional.')
  }

  const { data, error } = await result.supabase
    .from('tenant_staff_members')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      role,
      is_active: true,
    })
    .select('id, name, role, phone_e164, email, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel criar o profissional.', 500, error?.message)
  }

  return Response.json({ staffMember: data })
}
