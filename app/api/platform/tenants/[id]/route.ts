import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'
import { parseMoneyToCents } from '../../../../../src/lib/money'

const allowedStatuses = new Set(['pending', 'active', 'suspended', 'cancelled'])
const allowedBusinessTypes = new Set(['teacher', 'autonomous', 'clinic', 'salon', 'restaurant'])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json(
    {
      error: message,
      message,
    },
    { status }
  )
}

function parseAmountCents(value: unknown) {
  return parseMoneyToCents(value)
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
    return Response.json({ error: 'Tenant não encontrado.' }, { status: 404 })
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

  const { data: currentTenant, error: currentTenantError } = await result.supabase
    .from('tenants')
    .select('id, plan')
    .eq('id', id)
    .single()

  if (currentTenantError || !currentTenant) {
    return errorResponse('Tenant não encontrado.', 404, currentTenantError?.message)
  }

  const patch: Record<string, string | null> = {}

  for (const key of ['legal_name', 'cpf', 'email', 'birth_date', 'whatsapp_e164']) {
    if (typeof body[key] === 'string') {
      patch[key] = body[key].trim() || null
    }
  }

  const nextPlan = typeof body.plan === 'string'
    ? body.plan.trim()
    : currentTenant.plan

  if (nextPlan !== currentTenant.plan) {
    patch.plan = nextPlan
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

  const shouldUpdateBilling =
    typeof body.plan === 'string' ||
    body.monthly_amount !== undefined ||
    body.due_day !== undefined

  if (Object.keys(patch).length === 0 && !shouldUpdateBilling) {
    return errorResponse('Nenhuma alteracao para salvar.')
  }

  const { data: selectedPlan, error: selectedPlanError } = await result.supabase
    .from('platform_plans')
    .select('code, monthly_amount_cents, max_customer_groups, is_active')
    .eq('code', nextPlan)
    .maybeSingle()

  if (selectedPlanError) {
    return errorResponse('Não foi possível validar o plano selecionado.', 500, selectedPlanError.message)
  }

  if (!selectedPlan || !selectedPlan.is_active) {
    return errorResponse('Plano inválido ou inativo. Escolha um plano ativo.')
  }

  const amountCents = body.monthly_amount !== undefined
    ? parseAmountCents(body.monthly_amount)
    : selectedPlan.monthly_amount_cents
  const dueDay = body.due_day !== undefined ? Number(body.due_day) : null

  if (body.monthly_amount !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) {
    return errorResponse('Mensalidade inválida. Informe um valor maior que zero.')
  }

  if (dueDay !== null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
    return errorResponse('Dia de cobrança inválido. Informe um número entre 1 e 31.')
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

  if (shouldUpdateBilling) {
    const { data: subscription } = await result.supabase
      .from('subscriptions')
      .select('id')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    let subscriptionId = subscription?.id

    if (subscriptionId) {
      const { error: subscriptionError } = await result.supabase
        .from('subscriptions')
        .update({
          plan: nextPlan,
          status: 'active',
          activated_at: new Date().toISOString(),
        })
        .eq('id', subscriptionId)

      if (subscriptionError) {
        return errorResponse('Tenant atualizado, mas não foi possível atualizar a assinatura.', 500, subscriptionError.message)
      }
    } else {
      const { data: createdSubscription, error: subscriptionError } = await result.supabase
        .from('subscriptions')
        .insert({
          tenant_id: id,
          plan: nextPlan,
          status: 'active',
          activated_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (subscriptionError || !createdSubscription) {
        return errorResponse('Tenant atualizado, mas não foi possível criar a assinatura.', 500, subscriptionError?.message)
      }

      subscriptionId = createdSubscription.id
    }

    const { data: billingProfile } = await result.supabase
      .from('platform_tenant_billing_profiles')
      .select('id, due_day, status')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const billingPayload = {
      subscription_id: subscriptionId,
      amount_cents: amountCents,
      due_day: dueDay ?? billingProfile?.due_day ?? new Date().getDate(),
      status: billingProfile?.status ?? 'active',
      updated_at: new Date().toISOString(),
    }

    const billingResult = billingProfile
      ? await result.supabase
          .from('platform_tenant_billing_profiles')
          .update(billingPayload)
          .eq('id', billingProfile.id)
      : await result.supabase
          .from('platform_tenant_billing_profiles')
          .insert({
            tenant_id: id,
            ...billingPayload,
          })

    if (billingResult.error) {
      return errorResponse('Tenant atualizado, mas não foi possível atualizar a cobrança mensal.', 500, billingResult.error.message)
    }

    await result.supabase
      .from('tenant_billing_settings')
      .upsert({
        tenant_id: id,
        default_due_template_key: 'billing_reminder_due_today',
        default_overdue_template_key: 'billing_reminder_overdue',
        timezone: 'America/Fortaleza',
        max_customer_groups: selectedPlan.max_customer_groups,
      })
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

  const { data: tenantSnapshot, error: tenantSnapshotError } = await result.supabase
    .from('tenants')
    .select('id, legal_name, email, cpf, whatsapp_e164, business_type, plan, status')
    .eq('id', id)
    .maybeSingle()

  if (tenantSnapshotError || !tenantSnapshot) {
    return errorResponse('Tenant não encontrado.', 404, tenantSnapshotError?.message)
  }

  const { error: deleteEventError } = await result.supabase
    .from('platform_payment_events')
    .insert({
      tenant_id: id,
      platform_admin_auth_user_id: result.user.id,
      event_type: 'tenant_deleted',
      old_status: tenantSnapshot.status,
      new_status: 'deleted',
      source: 'manual_delete',
      note: 'Tenant excluído pelo painel da plataforma.',
      tenant_legal_name_snapshot: tenantSnapshot.legal_name,
      tenant_email_snapshot: tenantSnapshot.email,
      tenant_cpf_snapshot: tenantSnapshot.cpf,
      tenant_whatsapp_snapshot: tenantSnapshot.whatsapp_e164,
      tenant_business_type_snapshot: tenantSnapshot.business_type,
      tenant_plan_snapshot: tenantSnapshot.plan,
    })

  if (deleteEventError) {
    return errorResponse('Não foi possível registrar o histórico antes de excluir o tenant.', 500, deleteEventError.message)
  }

  const { data: tenantUsers, error: usersError } = await result.supabase
    .from('tenant_users')
    .select('auth_user_id')
    .eq('tenant_id', id)

  if (usersError) {
    return errorResponse(
      'Não foi possível localizar os usuários do tenant.',
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
      'Não foi possível excluir o tenant.',
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
