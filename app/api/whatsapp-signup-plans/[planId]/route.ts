import { requireTenantUser, tenantCanUseBilling } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function PATCH(request: Request, context: { params: Promise<{ planId: string }> }) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) return errorResponse('Acesso não permitido.', 403)
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const description = String(body?.description ?? '').trim() || null
  const amountCents = Number(body?.amount_cents)
  const dueDay = Number(body?.due_day)
  if (!name) return errorResponse('Informe o nome do plano.')
  if (!Number.isInteger(amountCents) || amountCents <= 0) return errorResponse('Informe um valor mensal válido.')
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return errorResponse('Informe um vencimento entre 1 e 31.')
  const { planId } = await context.params
  const { data, error } = await result.supabase.from('tenant_customer_signup_plans').update({
    name, description, amount_cents: amountCents, due_day: dueDay, updated_at: new Date().toISOString(),
  }).eq('id', planId).eq('tenant_id', result.tenantUser.tenant_id).eq('is_active', true)
    .select('id, name, description, amount_cents, due_day, is_active, sort_order').single()
  if (error || !data) return errorResponse('Não foi possível atualizar o plano.', 500, error?.message)
  return Response.json({ plan: data })
}

export async function DELETE(request: Request, context: { params: Promise<{ planId: string }> }) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) return errorResponse('Acesso não permitido.', 403)
  const { planId } = await context.params
  const { error } = await result.supabase.from('tenant_customer_signup_plans').update({
    is_active: false, updated_at: new Date().toISOString(),
  }).eq('id', planId).eq('tenant_id', result.tenantUser.tenant_id)
  if (error) return errorResponse('Não foi possível desativar o plano.', 500, error.message)
  return Response.json({ ok: true })
}
