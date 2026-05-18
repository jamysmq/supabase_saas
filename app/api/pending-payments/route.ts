import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cobranças disponíveis apenas em planos com cobrança mensal.', 403)
  }

  const { data, error } = await result.supabase
    .from('billing_cycles')
    .select(`
      id,
      customer_id,
      due_date,
      amount_cents,
      status,
      message_sent_at,
      tenant_customers!inner (
        full_name,
        phone_e164,
        is_active
      )
    `)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('status', 'overdue')
    .eq('tenant_customers.is_active', true)
    .order('due_date', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível carregar pagamentos pendentes.', 500, error.message)
  }

  return Response.json({
    payments: (data ?? []).map((cycle) => {
      const customer = firstRelation(cycle.tenant_customers)

      return {
        billing_cycle_id: cycle.id,
        customer_id: cycle.customer_id,
        customer_name: customer?.full_name ?? 'Cliente sem nome',
        phone: customer?.phone_e164 ?? '',
        due_date: cycle.due_date,
        amount_cents: cycle.amount_cents,
        status: cycle.status,
        message_sent_at: cycle.message_sent_at,
      }
    }),
  })
}
