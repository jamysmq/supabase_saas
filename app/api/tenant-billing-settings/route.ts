import { requireTenantUser } from '../../../src/lib/tenant-admin'
import {
  normalizePixKey,
  pixKeyTypes,
  type PixKeyType,
} from '../../../src/lib/payments/pix-br-code'

const allowedPixKeyTypes = new Set<string>(pixKeyTypes)

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)
  const pixKey = String(body?.pix_key ?? '').trim()
  const pixKeyType = String(body?.pix_key_type ?? '').trim()
  const pixBeneficiaryName = String(body?.pix_beneficiary_name ?? '').trim()
  const pixBeneficiaryCity = String(body?.pix_beneficiary_city ?? '').trim()

  if (!pixBeneficiaryName) {
    return errorResponse('Informe o nome do beneficiário.')
  }

  if (!pixBeneficiaryCity) {
    return errorResponse('Informe a cidade do beneficiário.')
  }

  if (!allowedPixKeyTypes.has(pixKeyType)) {
    return errorResponse('Tipo de chave Pix inválido.')
  }

  let normalizedPixKey = ''

  try {
    normalizedPixKey = normalizePixKey(pixKey, pixKeyType as PixKeyType)
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Chave Pix inválida.')
  }

  const now = new Date().toISOString()
  const { data: existing, error: existingError } = await result.supabase
    .from('tenant_billing_settings')
    .select('tenant_id')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (existingError) {
    return errorResponse('Não foi possível validar as configurações de Pix.', 500, existingError.message)
  }

  const query = existing
    ? result.supabase
        .from('tenant_billing_settings')
        .update({
          pix_key: normalizedPixKey,
          pix_key_type: pixKeyType,
          pix_beneficiary_name: pixBeneficiaryName,
          pix_beneficiary_city: pixBeneficiaryCity,
          updated_at: now,
        })
        .eq('tenant_id', result.tenantUser.tenant_id)
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_beneficiary_city, pix_collection_mode, timezone, max_customer_groups')
        .single()
    : result.supabase
        .from('tenant_billing_settings')
        .insert({
          tenant_id: result.tenantUser.tenant_id,
          pix_key: normalizedPixKey,
          pix_key_type: pixKeyType,
          pix_beneficiary_name: pixBeneficiaryName,
          pix_beneficiary_city: pixBeneficiaryCity,
          default_due_template_key: 'billing_reminder_due_today',
          default_overdue_template_key: 'billing_reminder_overdue',
          timezone: 'America/Fortaleza',
          max_customer_groups: 20,
          created_at: now,
          updated_at: now,
        })
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_beneficiary_city, pix_collection_mode, timezone, max_customer_groups')
        .single()

  const { data, error } = await query

  if (error || !data) {
    return errorResponse('Não foi possível salvar os dados de Pix.', 500, error?.message)
  }

  return Response.json({ settings: data })
}
