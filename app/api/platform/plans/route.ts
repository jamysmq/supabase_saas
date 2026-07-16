import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'
import { syncMonthlyPriceInPlanDescription } from '../../../../src/lib/platform-plan-description'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parseAmountCents(value: unknown) {
  return parseMoneyToCents(value)
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '_')
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase
    .from('platform_plans')
    .select(`
      code,
      name,
      description,
      monthly_amount_cents,
      currency,
      billing_interval,
      max_customer_groups,
      is_active,
      sort_order,
      created_at,
      updated_at
    `)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return errorResponse('Não foi possível carregar os planos.', 500, error.message)
  }

  return Response.json({ plans: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')
  }

  const code = normalizeCode(String(body.code || ''))
  const name = String(body.name || '').trim()
  const amountCents = parseAmountCents(body.monthly_amount)
  const maxCustomerGroups = Number(body.max_customer_groups ?? 20)
  const sortOrder = Number(body.sort_order ?? 0)

  if (!/^[a-z0-9_]+$/.test(code)) {
    return errorResponse('Código inválido. Use apenas letras minúsculas, números e underscore.')
  }

  if (!name) {
    return errorResponse('Informe o nome do plano.')
  }

  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return errorResponse('Mensalidade inválida.')
  }

  if (!Number.isInteger(maxCustomerGroups) || maxCustomerGroups < 0) {
    return errorResponse('Limite de grupos inválido.')
  }

  const { data, error } = await result.supabase
    .from('platform_plans')
    .insert({
      code,
      name,
      description: syncMonthlyPriceInPlanDescription(
        String(body.description || '').trim(),
        amountCents
      ),
      monthly_amount_cents: amountCents,
      currency: 'BRL',
      billing_interval: 'monthly',
      max_customer_groups: maxCustomerGroups,
      is_active: Boolean(body.is_active ?? true),
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      updated_at: new Date().toISOString(),
    })
    .select('code')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível criar o plano.', 500, error?.message)
  }

  return Response.json({ ok: true, plan: data })
}
