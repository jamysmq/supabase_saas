import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function dateParamToIso(value: string | null, fallback: Date) {
  if (!value) return fallback.toISOString()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString()
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Histórico de pagamentos disponível apenas em planos com cobrança mensal.', 403)
  }

  const url = new URL(request.url)
  const now = new Date()
  const defaultFrom = new Date(now)
  defaultFrom.setDate(defaultFrom.getDate() - 90)
  defaultFrom.setHours(0, 0, 0, 0)

  const defaultTo = new Date(now)
  defaultTo.setDate(defaultTo.getDate() + 1)
  defaultTo.setHours(0, 0, 0, 0)

  const from = dateParamToIso(url.searchParams.get('from'), defaultFrom)
  const to = dateParamToIso(url.searchParams.get('to'), defaultTo)
  const status = String(url.searchParams.get('status') ?? '').trim()

  if (new Date(to).getTime() <= new Date(from).getTime()) {
    return errorResponse('Período inválido.')
  }

  let cyclesQuery = result.supabase
    .from('billing_cycles')
    .select(`
      id,
      tenant_id,
      customer_id,
      billing_profile_id,
      reference_year,
      reference_month,
      due_date,
      amount_cents,
      currency,
      status,
      message_sent_at,
      paid_at,
      payment_note,
      created_at,
      updated_at,
      tenant_customers (
        full_name,
        phone_e164,
        email,
        cpf
      )
    `)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .gte('due_date', from.slice(0, 10))
    .lt('due_date', to.slice(0, 10))
    .order('due_date', { ascending: false })

  if (status) {
    cyclesQuery = cyclesQuery.eq('status', status)
  }

  const [{ data: cycles, error: cyclesError }, { data: events, error: eventsError }] =
    await Promise.all([
      cyclesQuery,
      result.supabase
        .from('tenant_payment_events')
        .select(`
          id,
          tenant_id,
          billing_cycle_id,
          billing_profile_id,
          customer_id,
          event_type,
          old_status,
          new_status,
          source,
          note,
          created_at,
          tenant_customers (
            full_name,
            phone_e164,
            email,
            cpf
          )
        `)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('event_type', 'billing_profile_status')
        .gte('created_at', from)
        .lt('created_at', to)
        .order('created_at', { ascending: false }),
    ])

  if (cyclesError) {
    return errorResponse('Não foi possível carregar histórico de pagamentos.', 500, cyclesError.message)
  }

  if (eventsError) {
    console.error('Não foi possível carregar eventos de cobrança do tenant.', eventsError.message)
  }

  return Response.json({
    cycles: cycles ?? [],
    events: events ?? [],
  })
}
