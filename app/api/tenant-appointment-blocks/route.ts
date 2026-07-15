import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function parseDate(value: unknown) {
  const date = new Date(String(value ?? ''))
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseAppointments(result.tenant)) return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)

  const { data, error } = await result.supabase.from('tenant_appointment_blocks')
    .select('id, starts_at, ends_at, reason, created_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .gte('ends_at', new Date(Date.now() - 86400000).toISOString())
    .order('starts_at', { ascending: true }).limit(100)

  if (error) return errorResponse('Nao foi possivel carregar os bloqueios da agenda.', 500, error.message)
  return Response.json({ blocks: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseAppointments(result.tenant)) return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)

  const body = await request.json().catch(() => null)
  const startsAt = parseDate(body?.starts_at)
  const endsAt = parseDate(body?.ends_at)
  const reason = String(body?.reason ?? '').trim() || null
  if (!startsAt || !endsAt || endsAt <= startsAt) return errorResponse('Informe um inicio e um fim validos para o bloqueio.')
  if (endsAt <= new Date()) return errorResponse('O fim do bloqueio precisa estar no futuro.')
  if (reason && reason.length > 240) return errorResponse('O motivo deve ter ate 240 caracteres.')

  const { data: overlap, error: overlapError } = await result.supabase.from('tenant_appointment_blocks')
    .select('id').eq('tenant_id', result.tenantUser.tenant_id)
    .lt('starts_at', endsAt.toISOString()).gt('ends_at', startsAt.toISOString()).limit(1)
  if (overlapError) return errorResponse('Nao foi possivel validar o periodo.', 500, overlapError.message)
  if (overlap?.length) return errorResponse('Esse periodo ja esta total ou parcialmente bloqueado.', 409)

  const { data, error } = await result.supabase.from('tenant_appointment_blocks').insert({
    tenant_id: result.tenantUser.tenant_id,
    starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason,
    created_by_tenant_user_id: result.tenantUser.id,
  }).select('id, starts_at, ends_at, reason, created_at').single()
  if (error || !data) return errorResponse('Nao foi possivel bloquear esse periodo.', 500, error?.message)
  return Response.json({ block: data }, { status: 201 })
}

export async function DELETE(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseAppointments(result.tenant)) return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)

  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) return errorResponse('Bloqueio nao informado.')
  const { data, error } = await result.supabase.from('tenant_appointment_blocks').delete()
    .eq('id', id).eq('tenant_id', result.tenantUser.tenant_id).select('id').maybeSingle()
  if (error) return errorResponse('Nao foi possivel remover o bloqueio.', 500, error.message)
  if (!data) return errorResponse('Bloqueio nao encontrado.', 404)
  return Response.json({ ok: true })
}
