import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cadastros pendentes estão disponíveis apenas para contas de professor com cobranças.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_customer_signup_requests')
    .select('id, full_name, customer_phone_e164, cpf, email, group_id, group_name_snapshot, amount_cents, due_day, notes, source, status, created_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return errorResponse('Não foi possível carregar os cadastros pendentes.', 500, error.message)
  }

  return Response.json({ signups: data ?? [] })
}
