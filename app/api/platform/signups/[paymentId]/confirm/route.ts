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

  const { error } = await result.supabase.rpc(
    'admin_confirm_signup_payment',
    {
      p_payment_id: paymentId,
      p_note: note || 'Confirmado pelo painel da plataforma',
    }
  )

  if (error) {
    return Response.json(
      { error: 'Could not confirm signup payment.' },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
