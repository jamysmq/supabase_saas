import { requireTenantUser, tenantCanUseOperationalFinance } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseOperationalFinance(result.tenant)) {
    return errorResponse('Financeiro operacional não disponível para este plano.', 403)
  }

  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  let query = result.supabase
    .from('tenant_service_revenue_events')
    .select(`
      id,
      appointment_id,
      customer_name_snapshot,
      customer_document_snapshot,
      customer_phone_snapshot,
      service_name_snapshot,
      staff_member_name_snapshot,
      amount_cents,
      currency,
      status,
      source,
      recognized_at,
      voided_at,
      created_at
    `)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .order('recognized_at', { ascending: false })

  if (from) {
    query = query.gte('recognized_at', from)
  }

  if (to) {
    query = query.lt('recognized_at', to)
  }

  const { data, error } = await query

  if (error) {
    return errorResponse('Não foi possível listar o financeiro operacional.', 500, error.message)
  }

  return Response.json({ events: data ?? [] })
}
