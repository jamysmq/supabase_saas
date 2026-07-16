import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../src/lib/money'
import type { SupabaseClient } from '@supabase/supabase-js'

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

async function fetchServiceStaffMemberIds(
  supabase: SupabaseClient,
  tenantId: string,
  serviceIds: string[]
) {
  if (serviceIds.length === 0) return new Map<string, string[]>()

  const { data, error } = await supabase
    .from('tenant_service_staff_members')
    .select('service_id, staff_member_id')
    .eq('tenant_id', tenantId)
    .in('service_id', serviceIds)

  if (error) throw error

  const map = new Map<string, string[]>()

  for (const row of data ?? []) {
    const current = map.get(row.service_id) ?? []
    current.push(row.staff_member_id)
    map.set(row.service_id, current)
  }

  return map
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

  let serviceStaffMemberIds: Map<string, string[]>

  try {
    serviceStaffMemberIds = await fetchServiceStaffMemberIds(
      result.supabase,
      result.tenantUser.tenant_id,
      (data ?? []).map((service) => service.id)
    )
  } catch (relationError) {
    return errorResponse(
      'Nao foi possivel listar os profissionais dos servicos.',
      500,
      relationError instanceof Error ? relationError.message : String(relationError)
    )
  }

  return Response.json({
    services: (data ?? []).map((service) => ({
      ...service,
      staff_member_ids: serviceStaffMemberIds.get(service.id) ?? [],
    })),
  })
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

  const { error: linkError } = await result.supabase.rpc(
    'admin_replace_service_staff_members',
    {
      p_tenant_id: result.tenantUser.tenant_id,
      p_service_id: data.id,
      p_staff_member_ids: staffMemberIds,
    }
  )

  if (linkError) {
    await result.supabase
      .from('tenant_services')
      .delete()
      .eq('id', data.id)
      .eq('tenant_id', result.tenantUser.tenant_id)

    return errorResponse('Nao foi possivel vincular profissionais ao servico.', 500, linkError.message)
  }

  return Response.json({ service: { ...data, staff_member_ids: staffMemberIds } })
}
