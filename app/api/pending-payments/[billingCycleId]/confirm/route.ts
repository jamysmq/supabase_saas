import { requireTenantUser, tenantCanUseBilling } from '../../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ billingCycleId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cobrancas disponiveis apenas em planos com cobranca mensal.', 403)
  }

  const { billingCycleId } = await context.params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === 'string' ? body.note.trim() : ''

  const { data: cycle, error: cycleError } = await result.supabase
    .from('billing_cycles')
    .select('id, tenant_id, customer_id, billing_profile_id, status')
    .eq('id', billingCycleId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (cycleError || !cycle) {
    return errorResponse('Pagamento nao encontrado.', 404, cycleError?.message)
  }

  const { error } = await result.supabase.rpc('admin_confirm_customer_payment', {
    p_billing_cycle_id: billingCycleId,
    p_note: note || 'Confirmado manualmente pelo painel',
  })

  if (error) {
    return errorResponse('Nao foi possivel confirmar o pagamento.', 500, error.message)
  }

  const { error: eventError } = await result.supabase
    .from('tenant_payment_events')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      billing_cycle_id: cycle.id,
      billing_profile_id: cycle.billing_profile_id,
      customer_id: cycle.customer_id,
      tenant_user_id: result.tenantUser.id,
      event_type: 'payment_status',
      old_status: cycle.status,
      new_status: 'paid_manual',
      source: 'manual',
      note: note || 'Confirmado manualmente pelo painel',
    })

  if (eventError) {
    console.error('Nao foi possivel registrar evento de pagamento do tenant.', eventError.message)
  }

  return Response.json({ ok: true })
}
