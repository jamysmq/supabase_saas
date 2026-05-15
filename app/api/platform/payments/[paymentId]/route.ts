import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

export async function DELETE(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params
  const deletedAt = new Date().toISOString()

  const { data, error } = await result.supabase
    .from('payments')
    .update({
      status: 'deleted',
      deleted_at: deletedAt,
    })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .select('id, tenant_id')
    .single()

  if (error || !data) {
    return Response.json(
      { error: 'Could not delete platform payment.' },
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
      new_status: 'deleted',
      source: 'manual_delete',
      note: 'Pagamento pendente excluido pelo painel da plataforma.',
    })

  if (eventError) {
    console.error('Could not register platform payment delete event.', eventError.message)
  }

  return Response.json({ ok: true })
}
