import { requireTenantUser, tenantCanUseBilling } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cadastros pendentes estão disponíveis apenas para contas de professor com cobranças.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_customer_signup_requests')
    .select('id, full_name, customer_phone_e164, cpf, email, birth_date, guardian_full_name, guardian_cpf, group_id, group_name_snapshot, amount_cents, due_day, notes, source, status, created_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return errorResponse('Não foi possível carregar os cadastros pendentes.', 500, error.message)
  }

  const [{ data: groups, error: groupsError }, { data: customers, error: customersError }] = await Promise.all([
    result.supabase
      .from('tenant_customer_groups')
      .select('id, name, max_members')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    result.supabase
      .from('tenant_customers')
      .select('group_id')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .not('group_id', 'is', null),
  ])

  if (groupsError || customersError) {
    return errorResponse('Não foi possível carregar a capacidade das turmas.', 500, groupsError?.message ?? customersError?.message)
  }

  const counts = new Map<string, number>()
  for (const customer of customers ?? []) {
    if (customer.group_id) counts.set(customer.group_id, (counts.get(customer.group_id) ?? 0) + 1)
  }

  return Response.json({
    signups: data ?? [],
    groups: (groups ?? []).map((group) => {
      const activeCustomersCount = counts.get(group.id) ?? 0
      return {
        ...group,
        active_customers_count: activeCustomersCount,
        is_full: group.max_members !== null && activeCustomersCount >= group.max_members,
      }
    }),
  })
}
