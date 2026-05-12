import { requireTenantUser } from '../../../../src/lib/tenant-admin'

export async function PATCH(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { groupId } = await context.params
  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const description = typeof body?.description === 'string'
    ? body.description.trim() || null
    : null

  if (!name) {
    return Response.json({ error: 'Group name is required.' }, { status: 400 })
  }

  const { data: group, error } = await result.supabase
    .from('tenant_customer_groups')
    .update({
      name,
      description,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('is_active', true)
    .select('id, name, description, is_active, created_at, updated_at')
    .single()

  if (error || !group) {
    return Response.json(
      { error: 'Could not update group.', message: error?.message },
      { status: 500 }
    )
  }

  return Response.json({ group })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ groupId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { groupId } = await context.params

  const { error: unlinkError } = await result.supabase
    .from('tenant_customers')
    .update({
      group_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('group_id', groupId)

  if (unlinkError) {
    return Response.json(
      { error: 'Could not unlink customers.', message: unlinkError.message },
      { status: 500 }
    )
  }

  const { error: groupError } = await result.supabase
    .from('tenant_customer_groups')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)
    .eq('tenant_id', result.tenantUser.tenant_id)

  if (groupError) {
    return Response.json(
      { error: 'Could not delete group.', message: groupError.message },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
