import { requirePlatformAdmin } from '../../../../../../src/lib/platform-admin'

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === 'string' ? body.note.trim() : ''

  const { data: publicPayment, error: publicPaymentError } = await result.supabase
    .from('payments')
    .select('id, status')
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
    const { error: updateError } = await result.supabase
      .from('payments')
      .update({
        status: 'paid',
        confirmed_source: 'platform_signup_panel',
        confirmed_note: note || 'Solicitacao publica aprovada pelo painel da plataforma',
      })
      .eq('id', paymentId)

    if (updateError) {
      return Response.json(
        { error: 'NÃ£o foi possÃ­vel aprovar a solicitacao publica.' },
        { status: 500 }
      )
    }

    return Response.json({ ok: true })
  }

  const { error } = await result.supabase.rpc(
    'admin_confirm_signup_payment',
    {
      p_payment_id: paymentId,
      p_note: note || 'Confirmado pelo painel da plataforma',
    }
  )

  if (error) {
    return Response.json(
      { error: 'Não foi possível confirmar o pagamento do cadastro.' },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
