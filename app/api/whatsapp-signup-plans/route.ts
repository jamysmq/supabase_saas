import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function parsePlan(body: Record<string, unknown> | null) {
  const name = String(body?.name ?? '').trim()
  const description = String(body?.description ?? '').trim() || null
  const amountCents = Number(body?.amount_cents)
  const dueDay = Number(body?.due_day)
  if (!name) return { error: 'Informe o nome do plano.' }
  if (!Number.isInteger(amountCents) || amountCents <= 0) return { error: 'Informe um valor mensal válido.' }
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return { error: 'Informe um vencimento entre 1 e 31.' }
  return { name, description, amount_cents: amountCents, due_day: dueDay }
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) return errorResponse('Acesso não permitido.', 403)

  const { data, error } = await result.supabase.from('tenant_customer_signup_plans')
    .select('id, name, description, amount_cents, due_day, is_active, sort_order')
    .eq('tenant_id', result.tenantUser.tenant_id).eq('is_active', true)
    .order('sort_order').order('name')
  if (error) return errorResponse('Não foi possível carregar os planos.', 500, error.message)
  return Response.json({ plans: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) return errorResponse('Acesso não permitido.', 403)
  const parsed = parsePlan(await request.json().catch(() => null))
  if ('error' in parsed) return errorResponse(parsed.error ?? 'Plano inválido.')

  const { data, error } = await result.supabase.from('tenant_customer_signup_plans').insert({
    tenant_id: result.tenantUser.tenant_id, ...parsed, is_active: true,
  }).select('id, name, description, amount_cents, due_day, is_active, sort_order').single()
  if (error || !data) return errorResponse('Não foi possível criar o plano.', 500, error?.message)
  return Response.json({ plan: data })
}
