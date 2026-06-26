import { createSupabaseAdminClient } from '../../../../src/lib/platform-admin'
import { isTenantPlanBusinessTypeCompatible } from '../../../../src/lib/plan-features'

const allowedBusinessTypes = new Set(['teacher', 'autonomous', 'clinic', 'salon', 'restaurant', 'loja_material', 'petshop'])

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient()
  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados invalidos. Recarregue a pagina e tente novamente.')
  }

  const legalName = String(body.legal_name || '').trim()
  const cpf = String(body.cpf || '').trim()
  const cpfDigits = onlyDigits(cpf)
  const email = String(body.email || '').trim().toLowerCase()
  const adminEmail = String(body.admin_email || body.email || '').trim().toLowerCase()
  const birthDate = String(body.birth_date || '').trim()
  const whatsapp = String(body.whatsapp_e164 || '').trim()
  const whatsappDigits = onlyDigits(whatsapp)
  const businessType = String(body.business_type || 'teacher').trim()
  const plan = String(body.plan || '').trim()
  const dueDay = Number(body.due_day)

  if (!legalName) return errorResponse('Informe o nome legal do cliente.')

  if (![11, 14].includes(cpfDigits.length)) {
    return errorResponse('CPF/CNPJ invalido. Informe 11 digitos para CPF ou 14 digitos para CNPJ.')
  }

  if (!email || !isValidEmail(email)) return errorResponse('E-mail do tenant invalido.')
  if (!adminEmail || !isValidEmail(adminEmail)) return errorResponse('E-mail admin invalido.')
  if (!birthDate) return errorResponse('Informe a data de nascimento ou abertura.')

  if (whatsappDigits.length < 12 || whatsappDigits.length > 13) {
    return errorResponse('WhatsApp invalido. Use o formato com pais e DDD, por exemplo 5583999999999.')
  }

  if (!allowedBusinessTypes.has(businessType)) {
    return errorResponse('Tipo de negocio invalido.')
  }

  const { data: selectedPlan, error: selectedPlanError } = await supabase
    .from('platform_plans')
    .select('code, name, is_active, monthly_amount_cents')
    .eq('code', plan)
    .maybeSingle()

  if (selectedPlanError) {
    return errorResponse('Nao foi possivel validar o plano selecionado.', 500)
  }

  if (!selectedPlan || !selectedPlan.is_active) {
    return errorResponse('Plano invalido ou inativo. Escolha um plano ativo.')
  }

  if (!isTenantPlanBusinessTypeCompatible(plan, businessType)) {
    return errorResponse('Plano indisponivel para o tipo de negocio selecionado.')
  }

  const amountCents = Number(selectedPlan.monthly_amount_cents)

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return errorResponse('O plano selecionado nao possui mensalidade configurada.', 500)
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    return errorResponse('Dia de cobranca invalido. Informe um numero entre 1 e 31.')
  }

  const payload = {
    source: 'public_signup_request',
    legal_name: legalName,
    cpf: cpfDigits,
    email,
    admin_email: adminEmail,
    birth_date: birthDate,
    whatsapp_e164: whatsappDigits,
    business_type: businessType,
    plan,
    plan_name: selectedPlan.name,
    tenant_status: 'pending',
    amount_cents: amountCents,
    due_day: dueDay,
    submitted_at: new Date().toISOString(),
  }

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      provider: 'manual',
      amount_cents: amountCents,
      billing_type: 'public_signup_request',
      status: 'pending',
      payload,
    })
    .select('id')
    .single()

  if (error || !payment) {
    return errorResponse('Nao foi possivel registrar a solicitacao de cadastro.', 500)
  }

  return Response.json({ ok: true, payment_id: payment.id })
}
