import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  const { requestId } = await context.params
  const body = await request.json().catch(() => null)
  const decision = body?.decision === 'approved' ? 'approved' : body?.decision === 'rejected' ? 'rejected' : ''

  if (!decision) {
    return Response.json({ error: 'Decisão inválida.' }, { status: 400 })
  }

  const { data, error } = await result.supabase
    .rpc('platform_review_tenant_staff_addition', {
      p_request_id: requestId,
      p_platform_admin_auth_user_id: result.user.id,
      p_decision: decision,
      p_review_notes: String(body?.reviewNotes ?? '').trim() || null,
    })
    .single()

  if (error || !data) {
    const alreadyReviewed = error?.message?.includes('already_reviewed')
    return Response.json(
      {
        error: alreadyReviewed
          ? 'Esta solicitação já foi analisada.'
          : 'Não foi possível analisar a solicitação.',
      },
      { status: alreadyReviewed ? 409 : 500 }
    )
  }

  return Response.json({ result: data })
}
