import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

const allowedStatuses = new Set(['pending', 'active', 'suspended', 'cancelled'])
const allowedBusinessTypes = new Set(['teacher', 'autonomous', 'clinic', 'salon'])

function errorResponse(message: string, status = 400, details?: string) {
  return Response.json(
    {
      error: message,
      message,
      details,
    },
    { status }
  )
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { id } = await context.params

  const { data: tenant, error: tenantError } = await result.supabase
    .from('tenants')
    .select(`
      id,
      status,
      business_type,
      plan,
      legal_name,
      cpf,
      email,
      birth_date,
      whatsapp_e164,
      asaas_customer_id,
      created_at,
      updated_at
    `)
    .eq('id', id)
    .single()

  if (tenantError || !tenant) {
    return Response.json({ error: 'Tenant not found.' }, { status: 404 })
  }

  const [{ data: users }, { data: subscription }, { data: settings }, { data: billingProfile }] =
    await Promise.all([
      result.supabase
        .from('tenant_users')
        .select('id, role, email, auth_user_id, must_change_password, created_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: true }),
      result.supabase
        .from('subscriptions')
        .select('id, plan, status, asaas_subscription_id, created_at, activated_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      result.supabase
        .from('tenant_billing_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, timezone, max_customer_groups')
        .eq('tenant_id', id)
        .maybeSingle(),
      result.supabase
        .from('platform_tenant_billing_profiles')
        .select('id, amount_cents, due_day, status, currency, created_at, updated_at')
        .eq('tenant_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  return Response.json({
    tenant,
    users: users ?? [],
    subscription,
    settings,
    billingProfile,
  })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { id } = await context.params
  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')
  }

  const patch: Record<string, string | null> = {}

  for (const key of ['legal_name', 'cpf', 'email', 'birth_date', 'whatsapp_e164', 'plan']) {
    if (typeof body[key] === 'string') {
      patch[key] = body[key].trim() || null
    }
  }

  if (typeof body.status === 'string') {
    if (!allowedStatuses.has(body.status)) {
      return errorResponse('Status inválido.')
    }

    patch.status = body.status
  }

  if (typeof body.business_type === 'string') {
    if (!allowedBusinessTypes.has(body.business_type)) {
      return errorResponse('Tipo de negócio inválido.')
    }

    patch.business_type = body.business_type
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse('Nenhuma alteração para salvar.')
  }

  const { data, error } = await result.supabase
    .from('tenants')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse(
      'Não foi possível atualizar o tenant.',
      500,
      error?.message
    )
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { id } = await context.params

  const { data: tenantUsers, error: usersError } = await result.supabase
    .from('tenant_users')
    .select('auth_user_id')
    .eq('tenant_id', id)

  if (usersError) {
    return errorResponse(
      'NÃ£o foi possÃ­vel localizar os usuÃ¡rios do tenant.',
      500,
      usersError.message
    )
  }

  const authUserIds = Array.from(
    new Set(
      (tenantUsers ?? [])
        .map((tenantUser) => tenantUser.auth_user_id)
        .filter(Boolean)
    )
  )
  const authUserTenantCounts = new Map<string, number>()

  if (authUserIds.length > 0) {
    const { data: linkedTenantUsers } = await result.supabase
      .from('tenant_users')
      .select('auth_user_id')
      .in('auth_user_id', authUserIds)

    for (const linkedTenantUser of linkedTenantUsers ?? []) {
      if (linkedTenantUser.auth_user_id) {
        authUserTenantCounts.set(
          linkedTenantUser.auth_user_id,
          (authUserTenantCounts.get(linkedTenantUser.auth_user_id) ?? 0) + 1
        )
      }
    }
  }

  const { data, error } = await result.supabase
    .from('tenants')
    .delete()
    .eq('id', id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse(
      'NÃ£o foi possÃ­vel excluir o tenant.',
      error?.code === 'PGRST116' ? 404 : 500,
      error?.message
    )
  }

  for (const authUserId of authUserIds) {
    if ((authUserTenantCounts.get(authUserId) ?? 0) <= 1) {
      await result.supabase.auth.admin.deleteUser(authUserId)
    }
  }

  return Response.json({ ok: true })
}
