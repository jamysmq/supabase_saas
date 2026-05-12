import { requireTenantUser } from '../../../../../src/lib/tenant-admin'

const allowedStatuses = new Set(['active', 'paused'])

export async function PATCH(
  request: Request,
  context: { params: Promise<{ profileId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { profileId } = await context.params
  const body = await request.json().catch(() => null)
  const status = typeof body?.status === 'string' ? body.status : ''

  if (!allowedStatuses.has(status)) {
    return Response.json({ error: 'Invalid status.' }, { status: 400 })
  }

  const { data: profile, error: profileError } = await result.supabase
    .from('customer_billing_profiles')
    .select(`
      id,
      customer_id,
      tenant_customers!inner (
        tenant_id
      )
    `)
    .eq('id', profileId)
    .eq('tenant_customers.tenant_id', result.tenantUser.tenant_id)
    .single()

  if (profileError || !profile) {
    return Response.json(
      { error: 'Billing profile not found.' },
      { status: 404 }
    )
  }

  const { error: updateError } = await result.supabase
    .from('customer_billing_profiles')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId)

  if (updateError) {
    return Response.json(
      { error: 'Could not update billing profile status.' },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
