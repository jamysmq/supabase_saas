import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

type StaffAdditionRequest = {
  id: string
  tenant_id: string
  name: string
  role: string | null
  status: string
  additional_amount_cents: number
  reviewed_at: string | null
  review_notes: string | null
  created_at: string
}

type RequestTenant = {
  id: string
  legal_name: string
  public_name: string | null
  plan: string
  business_type: string
}

type RequestBillingProfile = {
  tenant_id: string
  base_amount_cents: number | null
  additional_staff_count: number
  additional_staff_amount_cents: number
  amount_cents: number
  status: string
}

type StaffRemovalEvent = {
  id: string
  tenant_id: string
  staff_member_name_snapshot: string
  staff_member_role_snapshot: string | null
  active_from: string
  removed_at: string
  active_days: number
  charge_next_billing: boolean
  amount_cents: number
  consumed_at: string | null
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'pending'

  let query = result.supabase
    .from('tenant_staff_addition_requests')
    .select('id, tenant_id, name, role, status, additional_amount_cents, reviewed_at, review_notes, created_at')
    .order('created_at', { ascending: false })

  if (status !== 'all') query = query.eq('status', status)

  const { data: requests, error } = await query
  if (error) {
    return Response.json({ error: 'Não foi possível listar as solicitações.' }, { status: 500 })
  }

  const { data: removalData, error: removalError } = await result.supabase
    .from('tenant_staff_removal_events')
    .select('id, tenant_id, staff_member_name_snapshot, staff_member_role_snapshot, active_from, removed_at, active_days, charge_next_billing, amount_cents, consumed_at')
    .order('removed_at', { ascending: false })
    .limit(50)

  if (removalError) {
    return Response.json({ error: 'Não foi possível listar as remoções.' }, { status: 500 })
  }

  const staffRequests = (requests ?? []) as StaffAdditionRequest[]
  const removals = (removalData ?? []) as StaffRemovalEvent[]
  const tenantIds = [...new Set([
    ...staffRequests.map((item) => item.tenant_id),
    ...removals.map((item) => item.tenant_id),
  ])]
  const [tenantsResult, billingResult] = tenantIds.length > 0
    ? await Promise.all([
        result.supabase
          .from('tenants')
          .select('id, legal_name, public_name, plan, business_type')
          .in('id', tenantIds),
        result.supabase
          .from('platform_tenant_billing_profiles')
          .select('tenant_id, base_amount_cents, additional_staff_count, additional_staff_amount_cents, amount_cents, status')
          .in('tenant_id', tenantIds)
          .in('status', ['active', 'paused'])
          .order('created_at', { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }]

  const tenants = (tenantsResult.data ?? []) as RequestTenant[]
  const billingProfiles = (billingResult.data ?? []) as RequestBillingProfile[]
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]))
  const billingByTenantId = new Map<string, RequestBillingProfile>()
  for (const profile of billingProfiles) {
    if (!billingByTenantId.has(profile.tenant_id)) {
      billingByTenantId.set(profile.tenant_id, profile)
    }
  }

  return Response.json({
    requests: staffRequests.map((item) => ({
      ...item,
      tenant: tenantById.get(item.tenant_id) ?? null,
      billingProfile: billingByTenantId.get(item.tenant_id) ?? null,
    })),
    removals: removals.map((item) => ({
      ...item,
      tenant: tenantById.get(item.tenant_id) ?? null,
      billingProfile: billingByTenantId.get(item.tenant_id) ?? null,
    })),
  })
}
