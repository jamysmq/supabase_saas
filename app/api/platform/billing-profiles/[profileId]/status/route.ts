import { requirePlatformAdmin } from '../../../../../../src/lib/platform-admin'

const allowedStatuses = new Set(['active', 'paused'])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { profileId } = await context.params
  const body = await request.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''

  if (!allowedStatuses.has(status)) {
    return errorResponse('Status inválido.')
  }

  const { data: profile, error: profileError } = await result.supabase
    .from('platform_tenant_billing_profiles')
    .select('id, tenant_id, status')
    .eq('id', profileId)
    .single()

  if (profileError || !profile) {
    return errorResponse('Perfil de cobrança não encontrado.', 404, profileError?.message)
  }

  if (profile.status === status) {
    return Response.json({ ok: true })
  }

  const { error: updateError } = await result.supabase
    .from('platform_tenant_billing_profiles')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (updateError) {
    return errorResponse('Não foi possível atualizar o status da cobrança.', 500, updateError.message)
  }

  const { error: eventError } = await result.supabase
    .from('platform_payment_events')
    .insert({
      billing_profile_id: profile.id,
      tenant_id: profile.tenant_id,
      platform_admin_auth_user_id: result.user.id,
      event_type: 'billing_profile_status',
      old_status: profile.status,
      new_status: status,
      source: 'manual',
      note: status === 'active'
        ? 'Cobrança da plataforma ativada manualmente.'
        : 'Cobrança da plataforma pausada manualmente.',
    })

  if (eventError) {
    console.error('Não foi possível registrar o evento de status da cobrança da plataforma.', eventError.message)
  }

  return Response.json({ ok: true })
}
