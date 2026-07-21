import type { SupabaseClient } from '@supabase/supabase-js'
import { isTenantPlanBusinessTypeCompatible } from '../lib/plan-features'

const allowedBusinessTypes = new Set(['teacher', 'autonomous', 'clinic', 'salon', 'restaurant', 'loja_material', 'petshop', 'arena', 'academy'])

export class PlatformTenantCreationError extends Error {
  status: number
  details?: string

  constructor(message: string, status = 400, details?: string) {
    super(message)
    this.name = 'PlatformTenantCreationError'
    this.status = status
    this.details = details
  }
}

export type PlatformTenantCreationInput = {
  legal_name: unknown
  public_name: unknown
  cpf: unknown
  email: unknown
  birth_date: unknown
  whatsapp_e164: unknown
  plan: unknown
  status?: unknown
  admin_email?: unknown
  business_type?: unknown
  monthly_amount_cents: unknown
  due_day: unknown
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

function toPositiveInteger(value: unknown) {
  const numberValue = Number(value)

  return Number.isInteger(numberValue) ? numberValue : NaN
}

export async function createPlatformTenant(
  supabase: SupabaseClient,
  input: PlatformTenantCreationInput
) {
  const legalName = String(input.legal_name || '').trim()
  const publicName = String(input.public_name || '').trim()
  const cpf = String(input.cpf || '').trim()
  const cpfDigits = onlyDigits(cpf)
  const email = String(input.email || '').trim().toLowerCase()
  const birthDate = String(input.birth_date || '').trim()
  const whatsapp = String(input.whatsapp_e164 || '').trim()
  const whatsappDigits = onlyDigits(whatsapp)
  const plan = String(input.plan || '').trim()
  const status = String(input.status || 'active').trim()
  const adminEmail = String(input.admin_email || input.email || '').trim().toLowerCase()
  const businessType = String(input.business_type || 'teacher').trim()
  const amountCents = toPositiveInteger(input.monthly_amount_cents)
  const dueDay = toPositiveInteger(input.due_day)

  if (!legalName) {
    throw new PlatformTenantCreationError('Informe o nome legal do cliente.')
  }

  if (!publicName) {
    throw new PlatformTenantCreationError('Informe o nome fantasia do negócio.')
  }

  if (![11, 14].includes(cpfDigits.length)) {
    throw new PlatformTenantCreationError('CPF/CNPJ invalido. Informe 11 digitos para CPF ou 14 digitos para CNPJ.')
  }

  if (!email || !isValidEmail(email)) {
    throw new PlatformTenantCreationError('E-mail do tenant invalido.')
  }

  if (!adminEmail || !isValidEmail(adminEmail)) {
    throw new PlatformTenantCreationError('E-mail admin invalido.')
  }

  if (!birthDate) {
    throw new PlatformTenantCreationError('Informe a data de nascimento ou abertura.')
  }

  if (whatsappDigits.length < 12 || whatsappDigits.length > 13) {
    throw new PlatformTenantCreationError('WhatsApp invalido. Use o formato com pais e DDD, por exemplo 5583999999999.')
  }

  if (!allowedBusinessTypes.has(businessType)) {
    throw new PlatformTenantCreationError('Tipo de negocio invalido.')
  }

  const { data: selectedPlan, error: selectedPlanError } = await supabase
    .from('platform_plans')
    .select('code, is_active, max_customer_groups')
    .eq('code', plan)
    .maybeSingle()

  if (selectedPlanError) {
    throw new PlatformTenantCreationError(
      'Nao foi possivel validar o plano selecionado.',
      500,
      selectedPlanError.message
    )
  }

  if (!selectedPlan || !selectedPlan.is_active) {
    throw new PlatformTenantCreationError('Plano invalido ou inativo. Escolha um plano ativo.')
  }

  if (!isTenantPlanBusinessTypeCompatible(plan, businessType)) {
    throw new PlatformTenantCreationError('Plano indisponivel para o tipo de negocio selecionado.')
  }

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new PlatformTenantCreationError('Mensalidade invalida. Informe um valor maior que zero.')
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new PlatformTenantCreationError('Dia de cobranca invalido. Informe um numero entre 1 e 31.')
  }

  const temporaryPassword = generateTemporaryPassword()

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({
      legal_name: legalName,
      public_name: publicName,
      cpf: cpfDigits,
      email,
      birth_date: birthDate,
      whatsapp_e164: whatsappDigits,
      plan,
      status,
      business_type: businessType,
    })
    .select('id, legal_name, public_name, email, plan, status, business_type')
    .single()

  if (tenantError || !tenant) {
    throw new PlatformTenantCreationError(
      'Nao foi possivel criar o tenant no banco.',
      500,
      tenantError?.message
    )
  }

  const tenantId = tenant.id

  async function cleanupTenant() {
    await supabase.from('tenants').delete().eq('id', tenantId)
  }

  const { data: subscription, error: subscriptionError } = await supabase
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
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar a assinatura.',
      500,
      subscriptionError?.message
    )
  }

  const { error: settingsError } = await supabase
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
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar as configuracoes de cobranca.',
      500,
      settingsError.message
    )
  }

  const { data: tenantUser, error: tenantUserError } = await supabase
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
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar o usuario do tenant.',
      500,
      tenantUserError?.message
    )
  }

  const { data: platformBillingProfile, error: platformBillingError } = await supabase
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
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar a cobranca mensal da plataforma.',
      500,
      platformBillingError?.message
    )
  }

  const now = new Date()
  const initialDueDate = new Date(now.getFullYear(), now.getMonth(), dueDay)
  const { error: initialPaymentError } = await supabase
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
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar o pagamento pendente inicial.',
      500,
      initialPaymentError.message
    )
  }

  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  const existingUser = existingUsers.users.find((user) => user.email === adminEmail)

  const authResult = existingUser
    ? { data: { user: existingUser }, error: null }
    : await supabase.auth.admin.createUser({
        email: adminEmail,
        password: temporaryPassword,
        email_confirm: true,
      })

  if (authResult.error || !authResult.data.user) {
    await cleanupTenant()
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel criar o usuario de acesso.',
      500,
      authResult.error?.message
    )
  }

  const { error: linkError } = await supabase.rpc(
    'admin_link_auth_user_to_tenant_user',
    {
      p_auth_user_id: authResult.data.user.id,
      p_tenant_user_id: tenantUser.id,
    }
  )

  if (linkError) {
    if (!existingUser) {
      await supabase.auth.admin.deleteUser(authResult.data.user.id)
    }

    await cleanupTenant()
    throw new PlatformTenantCreationError(
      'Tenant criado, mas nao foi possivel vincular o usuario de acesso.',
      500,
      linkError.message
    )
  }

  return {
    tenant,
    admin_email: adminEmail,
    temporary_password: existingUser ? null : temporaryPassword,
    auth_user_existed: Boolean(existingUser),
  }
}
