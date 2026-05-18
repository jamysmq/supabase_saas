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
  const confirmedAt = new Date().toISOString()

  const { data, error } = await result.supabase
    .from('payments')
    .update({
      status: 'paid',
      confirmed_at: confirmedAt,
      confirmed_source: 'manual',
      confirmed_note: note || 'Confirmado manualmente pelo painel da plataforma.',
    })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .select('id, tenant_id')
    .single()

  if (error || !data) {
    return Response.json(
      { error: 'Não foi possível confirmar o pagamento da plataforma.' },
      { status: error?.code === 'PGRST116' ? 404 : 500 }
    )
  }

  const { error: eventError } = await result.supabase
    .from('platform_payment_events')
    .insert({
      payment_id: data.id,
      tenant_id: data.tenant_id,
      platform_admin_auth_user_id: result.user.id,
      event_type: 'payment_status',
      old_status: 'pending',
      new_status: 'paid',
      source: 'manual',
      note: note || 'Confirmado manualmente pelo painel da plataforma.',
    })

  if (eventError) {
    console.error('Não foi possível registrar o evento de confirmação do pagamento da plataforma.', eventError.message)
  }

  return Response.json({ ok: true })
}
