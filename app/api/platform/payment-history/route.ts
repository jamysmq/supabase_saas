import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

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
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

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

  let query = result.supabase
    .from('payments')
    .select(`
      id,
      tenant_id,
      subscription_id,
      provider,
      asaas_payment_id,
      amount_cents,
      billing_type,
      status,
      payload,
      created_at,
      confirmed_at,
      confirmed_source,
      confirmed_note,
      deleted_at,
      tenants (
        legal_name,
        email,
        cpf,
        whatsapp_e164,
        business_type,
        plan
      )
    `)
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return errorResponse('Não foi possível carregar histórico de pagamentos.', 500, error.message)
  }

  const paymentIds = (data ?? []).map((payment) => payment.id)
  const latestEventByPaymentId = new Map<string, {
    old_status: string | null
    new_status: string
    source: string
    event_type: string
    note: string | null
    created_at: string
  }>()

  if (paymentIds.length > 0) {
    const { data: events, error: eventsError } = await result.supabase
      .from('platform_payment_events')
      .select('payment_id, old_status, new_status, source, event_type, note, created_at')
      .in('payment_id', paymentIds)
      .order('created_at', { ascending: false })

    if (eventsError) {
      console.error('Não foi possível carregar eventos de pagamento.', eventsError.message)
    }

    for (const event of events ?? []) {
      if (event.payment_id && !latestEventByPaymentId.has(event.payment_id)) {
        latestEventByPaymentId.set(event.payment_id, {
          old_status: event.old_status,
          new_status: event.new_status,
          source: event.source,
          event_type: event.event_type,
          note: event.note,
          created_at: event.created_at,
        })
      }
    }
  }

  const { data: billingEvents, error: billingEventsError } = await result.supabase
    .from('platform_payment_events')
    .select(`
      id,
      billing_profile_id,
      tenant_id,
      old_status,
      new_status,
      source,
      event_type,
      note,
      created_at,
      tenant_legal_name_snapshot,
      tenant_email_snapshot,
      tenant_cpf_snapshot,
      tenant_whatsapp_snapshot,
      tenant_business_type_snapshot,
      tenant_plan_snapshot,
      tenants (
        legal_name,
        email,
        cpf,
        whatsapp_e164,
        business_type,
        plan
      )
    `)
    .in('event_type', ['billing_profile_status', 'tenant_deleted'])
    .gte('created_at', from)
    .lt('created_at', to)
    .order('created_at', { ascending: false })

  if (billingEventsError) {
    console.error('Não foi possível carregar eventos de cobrança.', billingEventsError.message)
  }

  return Response.json({
    payments: (data ?? []).map((payment) => ({
      ...payment,
      latest_event: latestEventByPaymentId.get(payment.id) ?? null,
    })),
    billingEvents: billingEvents ?? [],
  })
}
