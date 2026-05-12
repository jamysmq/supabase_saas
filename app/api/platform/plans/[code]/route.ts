import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'

function errorResponse(message: string, status = 400, details?: string) {
  return Response.json({ error: message, message, details }, { status })
}

function parseAmountCents(value: unknown) {
  return Math.round(Number(String(value ?? '').replace(',', '.')) * 100)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { code } = await context.params
  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')
  }

  const patch: Record<string, string | number | boolean | null> = {
    updated_at: new Date().toISOString(),
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return errorResponse('Informe o nome do plano.')
    patch.name = name
  }

  if (typeof body.description === 'string') {
    patch.description = body.description.trim() || null
  }

  if (body.monthly_amount !== undefined) {
    const amountCents = parseAmountCents(body.monthly_amount)
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return errorResponse('Mensalidade inválida.')
    }
    patch.monthly_amount_cents = amountCents
  }

  if (body.max_customer_groups !== undefined) {
    const maxCustomerGroups = Number(body.max_customer_groups)
    if (!Number.isInteger(maxCustomerGroups) || maxCustomerGroups < 0) {
      return errorResponse('Limite de grupos inválido.')
    }
    patch.max_customer_groups = maxCustomerGroups
  }

  if (body.sort_order !== undefined) {
    const sortOrder = Number(body.sort_order)
    patch.sort_order = Number.isFinite(sortOrder) ? sortOrder : 0
  }

  if (typeof body.is_active === 'boolean') {
    patch.is_active = body.is_active
  }

  const { data, error } = await result.supabase
    .from('platform_plans')
    .update(patch)
    .eq('code', code)
    .select('code')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível salvar o plano.', 500, error?.message)
  }

  return Response.json({ ok: true })
}
