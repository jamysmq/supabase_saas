import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

export async function GET(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params

  const { data: publicPayment, error: publicPaymentError } = await result.supabase
    .from('payments')
    .select('id, amount_cents, status, payload, created_at')
    .eq('id', paymentId)
    .eq('billing_type', 'public_signup_request')
    .maybeSingle()

  if (publicPaymentError) {
    return Response.json(
      { error: 'NÃ£o foi possÃ­vel carregar a solicitacao publica.' },
      { status: 500 }
    )
  }

  if (publicPayment) {
    return Response.json({
      detail: {
        payment_id: publicPayment.id,
        amount_cents: publicPayment.amount_cents,
        status: publicPayment.status,
        created_at: publicPayment.created_at,
        ...(publicPayment.payload as Record<string, unknown> | null),
      },
      authPayload: {
        email: (publicPayment.payload as Record<string, unknown> | null)?.admin_email ??
          (publicPayment.payload as Record<string, unknown> | null)?.email ??
          null,
        source: 'public_signup_request',
        note: 'Ao aprovar, crie o tenant com estes dados e gere a senha temporaria pelo painel.',
      },
    })
  }

  const [{ data: detail, error: detailError }, { data: authPayload }] =
    await Promise.all([
      result.supabase.rpc('admin_get_pending_signup_detail', {
        p_payment_id: paymentId,
      }),
      result.supabase.rpc('admin_get_signup_auth_payload', {
        p_payment_id: paymentId,
      }),
    ])

  if (detailError) {
    return Response.json(
      { error: 'Não foi possível carregar os detalhes do cadastro.' },
      { status: 500 }
    )
  }

  return Response.json({
    detail,
    authPayload,
  })
}
