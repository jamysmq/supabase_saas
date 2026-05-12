import { requireTenantUser } from '../../../src/lib/tenant-admin'

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { data: groups, error } = await result.supabase
    .from('tenant_customer_groups')
    .select('id, name, description, is_active, created_at, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    return Response.json(
      { error: 'Could not list groups.', message: error.message },
      { status: 500 }
    )
  }

  const { data: customers, error: customersError } = await result.supabase
    .from('tenant_customers')
    .select('group_id')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .not('group_id', 'is', null)

  if (customersError) {
    return Response.json(
      { error: 'Could not count group members.', message: customersError.message },
      { status: 500 }
    )
  }

  const counts = new Map<string, number>()

  for (const customer of customers ?? []) {
    if (customer.group_id) {
      counts.set(customer.group_id, (counts.get(customer.group_id) ?? 0) + 1)
    }
  }

  return Response.json({
    groups: (groups ?? []).map((group) => ({
      ...group,
      active_customers_count: counts.get(group.id) ?? 0,
    })),
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string'
    ? body.description.trim() || null
    : null
    
  if (!name) {
    return Response.json({ error: 'Group name is required.' }, { status: 400 })
  }

  const { data: group, error: groupError } = await result.supabase
    .from('tenant_customer_groups')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      description,
      is_active: true,
    })
    .select('id, name, description, is_active, created_at, updated_at')
    .single()

  if (groupError) {
    return Response.json(
      {
        error: 'Could not create group.',
        message: groupError.message,
        code: groupError.code,
      },
      { status: 500 }
    )
  }

  return Response.json({ group })
}
