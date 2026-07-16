import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'
import { parseMoneyToCents } from '../../../../../src/lib/money'
import { syncMonthlyPriceInPlanDescription } from '../../../../../src/lib/platform-plan-description'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parseAmountCents(value: unknown) {
  return parseMoneyToCents(value)
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
  let amountCents: number | null = null

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (!name) return errorResponse('Informe o nome do plano.')
    patch.name = name
  }

  if (typeof body.description === 'string') {
    patch.description = body.description.trim() || null
  }

  if (body.monthly_amount !== undefined) {
    amountCents = parseAmountCents(body.monthly_amount)
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      return errorResponse('Mensalidade inválida.')
    }
    patch.monthly_amount_cents = amountCents
  }

  if (amountCents !== null) {
    patch.description = syncMonthlyPriceInPlanDescription(
      typeof body.description === 'string' ? body.description : '',
      amountCents
    )
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

  const { data: currentPlan, error: currentPlanError } = await result.supabase
    .from('platform_plans')
    .select('code, name, description, monthly_amount_cents, max_customer_groups, sort_order, is_active')
    .eq('code', code)
    .maybeSingle()

  if (currentPlanError || !currentPlan) {
    return errorResponse('Plano não encontrado.', 404, currentPlanError?.message)
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

  let updatedBillingProfiles = 0

  if (amountCents !== null && amountCents !== currentPlan.monthly_amount_cents) {
    const { data: tenants, error: tenantsError } = await result.supabase
      .from('tenants')
      .select('id')
      .eq('plan', code)

    if (tenantsError) {
      await result.supabase.from('platform_plans').update(currentPlan).eq('code', code)
      return errorResponse(
        'Não foi possível localizar os clientes vinculados ao plano.',
        500,
        tenantsError.message
      )
    }

    const tenantIds = (tenants ?? []).map((tenant) => tenant.id)

    if (tenantIds.length > 0) {
      const { data: profiles, error: profilesError } = await result.supabase
        .from('platform_tenant_billing_profiles')
        .update({
          amount_cents: amountCents,
          updated_at: new Date().toISOString(),
        })
        .in('tenant_id', tenantIds)
        .select('id')

      if (profilesError) {
        await result.supabase.from('platform_plans').update(currentPlan).eq('code', code)
        return errorResponse(
          'Não foi possível aplicar o novo valor aos clientes do plano.',
          500,
          profilesError.message
        )
      }

      updatedBillingProfiles = profiles?.length ?? 0
    }
  }

  return Response.json({ ok: true, updated_billing_profiles: updatedBillingProfiles })
}
