import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('O cadastro de alunos pelo WhatsApp está disponível apenas para professores com cobranças.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenants')
    .select('whatsapp_customer_signup_enabled, whatsapp_signup_billing_mode, whatsapp_signup_fixed_amount_cents, whatsapp_signup_fixed_due_day')
    .eq('id', result.tenantUser.tenant_id)
    .single()

  if (error || !data) return errorResponse('Não foi possível carregar as configurações do cadastro.', 500, error?.message)
  return Response.json({ settings: data })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('O cadastro de alunos pelo WhatsApp está disponível apenas para professores com cobranças.', 403)
  }

  const body = await request.json().catch(() => null)
  const patch: Record<string, boolean | string | number | null> = {}
  if (typeof body?.enabled === 'boolean') patch.whatsapp_customer_signup_enabled = body.enabled

  if (body?.billing_mode !== undefined) {
    if (body.billing_mode !== 'fixed' && body.billing_mode !== 'plans') {
      return errorResponse('Escolha mensalidade fixa ou planos de mensalidade.')
    }
    patch.whatsapp_signup_billing_mode = body.billing_mode
  }

  if (body?.fixed_amount_cents !== undefined) {
    const amount = Number(body.fixed_amount_cents)
    if (!Number.isInteger(amount) || amount <= 0) return errorResponse('Informe um valor fixo válido.')
    patch.whatsapp_signup_fixed_amount_cents = amount
  }

  if (body?.fixed_due_day !== undefined) {
    const dueDay = Number(body.fixed_due_day)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return errorResponse('Informe um vencimento entre 1 e 31.')
    patch.whatsapp_signup_fixed_due_day = dueDay
  }

  if (Object.keys(patch).length === 0) return errorResponse('Nenhuma configuração foi informada.')

  const { data, error } = await result.supabase
    .from('tenants')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.tenantUser.tenant_id)
    .select('whatsapp_customer_signup_enabled, whatsapp_signup_billing_mode, whatsapp_signup_fixed_amount_cents, whatsapp_signup_fixed_due_day')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível atualizar o cadastro pelo WhatsApp.', 500, error?.message)
  }

  return Response.json({ settings: data })
}
