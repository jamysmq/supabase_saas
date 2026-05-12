import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

export async function GET(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params

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
      { error: 'Could not load signup detail.' },
      { status: 500 }
    )
  }

  return Response.json({
    detail,
    authPayload,
  })
}
