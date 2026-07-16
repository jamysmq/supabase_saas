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

function parseDurationMinutes(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return NaN
  }

  return Number(value)
}

function parseStaffMemberIds(value: unknown) {
  if (!Array.isArray(value)) return []

  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean)
    )
  )
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
  const durationMinutes = parseDurationMinutes(body?.duration_minutes)
  const priceCents = parsePriceCents(body?.price ?? body?.price_cents)
  const staffMemberIds = parseStaffMemberIds(body?.staff_member_ids)

  if (!name) {
    return errorResponse('Informe o nome do serviço.')
  }

  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) {
    return errorResponse('Duração inválida. Informe entre 15 e 480 minutos.')
  }

  if (Number.isNaN(priceCents)) {
    return errorResponse('Valor inválido. Informe um valor maior ou igual a zero.')
  }

  if (staffMemberIds.length === 0) {
    return errorResponse('Selecione pelo menos um profissional para o servico.')
  }

  const { count: staffCount, error: staffError } = await result.supabase
    .from('tenant_staff_members')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .in('id', staffMemberIds)

  if (staffError) {
    return errorResponse('Nao foi possivel validar os profissionais do servico.', 500, staffError.message)
  }

  if ((staffCount ?? 0) !== staffMemberIds.length) {
    return errorResponse('Selecione apenas profissionais ativos deste negócio.')
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

  const { error: linkError } = await result.supabase.rpc(
    'admin_replace_service_staff_members',
    {
      p_tenant_id: result.tenantUser.tenant_id,
      p_service_id: serviceId,
      p_staff_member_ids: staffMemberIds,
    }
  )

  if (linkError) {
    return errorResponse('Nao foi possivel vincular profissionais ao servico.', 500, linkError.message)
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
    .delete()
    .eq('id', serviceId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível excluir o serviço.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}
