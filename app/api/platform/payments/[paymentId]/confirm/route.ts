import { requirePlatformAdmin } from '../../../../../../src/lib/platform-admin'

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params

  const { data, error } = await result.supabase
    .from('payments')
    .update({
      status: 'paid',
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (error || !data) {
    return Response.json(
      { error: 'Could not confirm platform payment.' },
      { status: error?.code === 'PGRST116' ? 404 : 500 }
    )
  }

  return Response.json({ ok: true })
}
