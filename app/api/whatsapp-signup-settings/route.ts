import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('O cadastro de alunos pelo WhatsApp está disponível apenas para professores com cobranças.', 403)
  }

  const body = await request.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return errorResponse('Informe se o cadastro pelo WhatsApp deve ficar ativo ou inativo.')
  }

  const { data, error } = await result.supabase
    .from('tenants')
    .update({
      whatsapp_customer_signup_enabled: body.enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.tenantUser.tenant_id)
    .select('whatsapp_customer_signup_enabled')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível atualizar o cadastro pelo WhatsApp.', 500, error?.message)
  }

  return Response.json({ enabled: data.whatsapp_customer_signup_enabled })
}
