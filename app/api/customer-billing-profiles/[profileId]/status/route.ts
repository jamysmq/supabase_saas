import { requireTenantUser, tenantCanUseBilling } from '../../../../../src/lib/tenant-admin'

const allowedStatuses = new Set(['active', 'paused'])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cobrancas disponiveis apenas em planos com cobranca mensal.', 403)
  }

  const { profileId } = await context.params
  const body = await request.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''

  if (!allowedStatuses.has(status)) {
    return errorResponse('Status invalido.')
  }

  const { data: profile, error: profileError } = await result.supabase
    .from('customer_billing_profiles')
    .select(`
      id,
      customer_id,
      tenant_id,
      status,
      tenant_customers!inner (
        tenant_id
      )
    `)
    .eq('id', profileId)
    .eq('tenant_customers.tenant_id', result.tenantUser.tenant_id)
    .single()

  if (profileError || !profile) {
    return errorResponse('Perfil de cobranca nao encontrado.', 404, profileError?.message)
  }

  if (profile.status === status) {
    return Response.json({ ok: true })
  }

  const { error: updateError } = await result.supabase
    .from('customer_billing_profiles')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (updateError) {
    return errorResponse('Nao foi possivel atualizar a cobranca.', 500, updateError.message)
  }

  const { error: eventError } = await result.supabase
    .from('tenant_payment_events')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      billing_profile_id: profile.id,
      customer_id: profile.customer_id,
      tenant_user_id: result.tenantUser.id,
      event_type: 'billing_profile_status',
      old_status: profile.status,
      new_status: status,
      source: 'manual',
      note: status === 'active'
        ? 'Cobranca do cliente ativada manualmente.'
        : 'Cobranca do cliente pausada manualmente.',
    })

  if (eventError) {
    console.error('Nao foi possivel registrar evento de cobranca do cliente.', eventError.message)
  }

  return Response.json({ ok: true })
}
