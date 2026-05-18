import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const token = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16)

  return `Temp${token}!9`
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase
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
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json(
      { error: 'Não foi possível listar os tenants.' },
      { status: 500 }
    )
  }

  const tenants = data ?? []
  const tenantIds = tenants.map((tenant) => tenant.id)
  const pendingTenantIds = new Set<string>()
  const billingProfileByTenantId = new Map<
    string,
    {
      id: string
      amount_cents: number
      due_day: number
      status: string
    }
  >()
  const subscriptionByTenantId = new Map<
    string,
    {
      id: string
      status: string
    }
  >()

  if (tenantIds.length > 0) {
    const [pendingPaymentsResult, billingProfilesResult, subscriptionsResult] =
      await Promise.all([
        result.supabase
          .from('payments')
          .select('tenant_id')
          .in('tenant_id', tenantIds)
          .eq('status', 'pending'),
        result.supabase
          .from('platform_tenant_billing_profiles')
          .select('id, tenant_id, amount_cents, due_day, status')
          .in('tenant_id', tenantIds)
          .order('created_at', { ascending: false }),
        result.supabase
          .from('subscriptions')
          .select('id, tenant_id, status')
          .in('tenant_id', tenantIds)
          .order('created_at', { ascending: false }),
      ])

    for (const payment of pendingPaymentsResult.data ?? []) {
      if (payment.tenant_id) {
        pendingTenantIds.add(payment.tenant_id)
      }
    }

    for (const profile of billingProfilesResult.data ?? []) {
      if (profile.tenant_id && !billingProfileByTenantId.has(profile.tenant_id)) {
        billingProfileByTenantId.set(profile.tenant_id, {
          id: profile.id,
          amount_cents: profile.amount_cents,
          due_day: profile.due_day,
          status: profile.status,
        })
      }
    }

    for (const subscription of subscriptionsResult.data ?? []) {
      if (subscription.tenant_id && !subscriptionByTenantId.has(subscription.tenant_id)) {
        subscriptionByTenantId.set(subscription.tenant_id, {
          id: subscription.id,
          status: subscription.status,
        })
      }
    }
  }

  return Response.json({
    tenants: tenants.map((tenant) => ({
      ...tenant,
      has_pending_payment: pendingTenantIds.has(tenant.id),
      platform_billing_profile: billingProfileByTenantId.get(tenant.id) ?? null,
      subscription: subscriptionByTenantId.get(tenant.id) ?? null,
    })),
  })
}

export async function POST(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const supabase = result.supabase

  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')
  }

  const legalName = String(body.legal_name || '').trim()
  const cpf = String(body.cpf || '').trim()
  const cpfDigits = onlyDigits(cpf)
  const email = String(body.email || '').trim().toLowerCase()
  const birthDate = String(body.birth_date || '').trim()
  const whatsapp = String(body.whatsapp_e164 || '').trim()
  const whatsappDigits = onlyDigits(whatsapp)
  const plan = String(body.plan || 'basic').trim()
  const status = String(body.status || 'active').trim()
  const adminEmail = String(body.admin_email || body.email || '').trim().toLowerCase()
  const businessType = String(body.business_type || 'teacher').trim()

  if (!legalName) {
    return errorResponse('Informe o nome legal do cliente.')
  }

  if (![11, 14].includes(cpfDigits.length)) {
    return errorResponse('CPF/CNPJ inválido. Informe 11 dígitos para CPF ou 14 dígitos para CNPJ.')
  }

  if (!email || !isValidEmail(email)) {
    return errorResponse('E-mail do tenant inválido.')
  }

  if (!adminEmail || !isValidEmail(adminEmail)) {
    return errorResponse('E-mail admin inválido.')
  }

  if (!birthDate) {
    return errorResponse('Informe a data de nascimento ou abertura.')
  }

  if (whatsappDigits.length < 12 || whatsappDigits.length > 13) {
    return errorResponse('WhatsApp inválido. Use o formato com país e DDD, por exemplo 5583999999999.')
  }

  if (!allowedBusinessTypes.has(businessType)) {
    return errorResponse('Tipo de negócio inválido.')
  }

  const { data: selectedPlan, error: selectedPlanError } = await result.supabase
    .from('platform_plans')
    .select('code, is_active, max_customer_groups')
    .eq('code', plan)
    .maybeSingle()

  if (selectedPlanError) {
    return errorResponse('Não foi possível validar o plano selecionado.', 500, selectedPlanError.message)
  }

  if (!selectedPlan || !selectedPlan.is_active) {
    return errorResponse('Plano inválido ou inativo. Escolha um plano ativo.')
  }

  const amountCents = parseMoneyToCents(body.monthly_amount)
  const dueDay = Number(body.due_day)

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return errorResponse('Mensalidade inválida. Informe um valor maior que zero.')
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return errorResponse('Dia de cobrança inválido. Informe um número entre 1 e 31.')
  }

  const temporaryPassword = generateTemporaryPassword()

  const { data: tenant, error: tenantError } = await result.supabase
    .from('tenants')
    .insert({
      legal_name: legalName,
      cpf: cpfDigits,
      email,
      birth_date: birthDate,
      whatsapp_e164: whatsappDigits,
      plan,
      status,
      business_type: businessType,
    })
    .select('id, legal_name, email, plan, status, business_type')
    .single()

  if (tenantError || !tenant) {
    return errorResponse('Não foi possível criar o tenant no banco.', 500, tenantError?.message)
  }

  const tenantId = tenant.id

  async function cleanupTenant() {
    await supabase.from('tenants').delete().eq('id', tenantId)
  }

  const { data: subscription, error: subscriptionError } = await result.supabase
    .from('subscriptions')
    .insert({
      tenant_id: tenant.id,
      plan,
      status: 'active',
      activated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (subscriptionError || !subscription) {
    await cleanupTenant()
    return errorResponse('Tenant criado, mas não foi possível criar a assinatura.', 500, subscriptionError.message)
  }

  const { error: settingsError } = await result.supabase
    .from('tenant_billing_settings')
    .insert({
      tenant_id: tenant.id,
      default_due_template_key: 'billing_reminder_due_today',
      default_overdue_template_key: 'billing_reminder_overdue',
      timezone: 'America/Fortaleza',
      max_customer_groups: selectedPlan.max_customer_groups,
    })

  if (settingsError) {
    await cleanupTenant()
    return errorResponse('Tenant criado, mas não foi possível criar as configurações de cobrança.', 500, settingsError.message)
  }

  const { data: tenantUser, error: tenantUserError } = await result.supabase
    .from('tenant_users')
    .insert({
      tenant_id: tenant.id,
      role: 'admin',
      email: adminEmail,
      must_change_password: true,
      temp_password_created_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (tenantUserError || !tenantUser) {
    await cleanupTenant()
    return errorResponse('Tenant criado, mas não foi possível criar o usuário do tenant.', 500, tenantUserError?.message)
  }

  const { data: platformBillingProfile, error: platformBillingError } = await result.supabase
    .from('platform_tenant_billing_profiles')
    .insert({
      tenant_id: tenant.id,
      subscription_id: subscription.id,
      amount_cents: amountCents,
      due_day: dueDay,
      status: 'active',
    })
    .select('id')
    .single()

  if (platformBillingError || !platformBillingProfile) {
    await cleanupTenant()
    return errorResponse('Tenant criado, mas não foi possível criar a cobrança mensal da plataforma.', 500, platformBillingError.message)
  }

  const now = new Date()
  const initialDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay)
  const { error: initialPaymentError } = await result.supabase
    .from('payments')
    .insert({
      tenant_id: tenant.id,
      subscription_id: subscription.id,
      provider: 'manual',
      amount_cents: amountCents,
      billing_type: 'platform_subscription',
      status: 'pending',
      payload: {
        due_date: initialDueDate.toISOString().slice(0, 10),
        source: 'tenant_creation',
        billing_profile_id: platformBillingProfile.id,
      },
    })

  if (initialPaymentError) {
    await cleanupTenant()
    return errorResponse('Tenant criado, mas não foi possível criar o pagamento pendente inicial.', 500, initialPaymentError.message)
  }

  const { data: existingUsers } = await result.supabase.auth.admin.listUsers()
  const existingUser = existingUsers.users.find((user) => user.email === adminEmail)

  const authResult = existingUser
    ? { data: { user: existingUser }, error: null }
    : await result.supabase.auth.admin.createUser({
        email: adminEmail,
        password: temporaryPassword,
        email_confirm: true,
      })

  if (authResult.error || !authResult.data.user) {
    await cleanupTenant()

    return errorResponse(
      'Tenant criado, mas não foi possível criar o usuário de acesso.',
      500,
      authResult.error?.message
    )
  }

  const { error: linkError } = await result.supabase.rpc(
    'admin_link_auth_user_to_tenant_user',
    {
      p_auth_user_id: authResult.data.user.id,
      p_tenant_user_id: tenantUser.id,
    }
  )

  if (linkError) {
    if (!existingUser) {
      await result.supabase.auth.admin.deleteUser(authResult.data.user.id)
    }

    await cleanupTenant()

    return errorResponse(
      'Tenant criado, mas não foi possível vincular o usuário de acesso.',
      500,
      linkError.message
    )
  }

  return Response.json({
    tenant,
    admin_email: adminEmail,
    temporary_password: existingUser ? null : temporaryPassword,
    auth_user_existed: Boolean(existingUser),
  })
}
