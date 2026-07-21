import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

function publicSignupFromPayment(payment: {
  id: string
  amount_cents: number | null
  status: string | null
  created_at: string
  payload: Record<string, unknown> | null
}) {
  const payload = payment.payload ?? {}

  return {
    id: payment.id,
    payment_id: payment.id,
    legal_name: payload.legal_name ?? null,
    cpf: payload.cpf ?? null,
    email: payload.email ?? null,
    admin_email: payload.admin_email ?? null,
    whatsapp_e164: payload.whatsapp_e164 ?? null,
    business_type: payload.business_type ?? null,
    plan: payload.plan ?? null,
    plan_name: payload.plan_name ?? null,
    resource_booking_plus_requested:
      payload.resource_booking_plus_requested ?? false,
    amount_cents: payment.amount_cents,
    due_day: payload.due_day ?? null,
    status: payment.status,
    source: 'public_signup_request',
    created_at: payment.created_at,
  }
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase.rpc(
    'admin_list_pending_signups'
  )

  if (error) {
    return Response.json(
      { error: 'Não foi possível listar os cadastros pendentes.' },
      { status: 500 }
    )
  }

  const { data: publicPayments, error: publicPaymentsError } = await result.supabase
    .from('payments')
    .select('id, amount_cents, status, payload, created_at')
    .eq('billing_type', 'public_signup_request')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (publicPaymentsError) {
    return Response.json(
      { error: 'NÃ£o foi possÃ­vel listar as solicitacoes publicas.' },
      { status: 500 }
    )
  }

  return Response.json({
    signups: [
      ...(data ?? []),
      ...((publicPayments ?? []).map(publicSignupFromPayment)),
    ],
  })
}
