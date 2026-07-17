import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'
import {
  createPlatformTenant,
  PlatformTenantCreationError,
} from '../../../../src/services/platform-tenants'

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
      public_name,
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
      { error: 'Nao foi possivel listar os tenants.' },
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
      base_amount_cents: number | null
      additional_staff_count: number
      additional_staff_amount_cents: number
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
          .select('id, tenant_id, amount_cents, base_amount_cents, additional_staff_count, additional_staff_amount_cents, due_day, status')
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
          base_amount_cents: profile.base_amount_cents,
          additional_staff_count: profile.additional_staff_count,
          additional_staff_amount_cents: profile.additional_staff_amount_cents,
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

  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados invalidos. Recarregue a pagina e tente novamente.')
  }

  const amountCents = parseMoneyToCents(body.monthly_amount)

  try {
    const created = await createPlatformTenant(result.supabase, {
      ...body,
      monthly_amount_cents: amountCents,
    })

    return Response.json(created)
  } catch (error) {
    if (error instanceof PlatformTenantCreationError) {
      return errorResponse(error.message, error.status, error.details)
    }

    return errorResponse('Nao foi possivel criar o tenant.', 500)
  }
}
