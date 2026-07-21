import { requireTenantUser, tenantCanUseBilling } from '../../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ customerId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Alunos e cobranças estão disponíveis apenas em planos com cobrança mensal.', 403)
  }

  const { customerId } = await context.params
  const body = await request.json().catch(() => null)
  const isActive = body?.is_active

  if (typeof isActive !== 'boolean') {
    return errorResponse('Informe se o aluno deve ficar ativo ou inativo.')
  }

  const { data: customer, error: customerError } = await result.supabase
    .from('tenant_customers')
    .select('id, full_name, is_active')
    .eq('id', customerId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (customerError) {
    return errorResponse('Não foi possível consultar o aluno.', 500, customerError.message)
  }

  if (!customer) {
    return errorResponse('Aluno não encontrado.', 404)
  }

  if (customer.is_active === isActive) {
    return Response.json({ ok: true, customer })
  }

  const { data: updatedCustomer, error: updateError } = await result.supabase
    .from('tenant_customers')
    .update({ is_active: isActive })
    .eq('id', customer.id)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id, full_name, is_active')
    .single()

  if (updateError) {
    return errorResponse(
      `Não foi possível ${isActive ? 'reativar' : 'desativar'} o aluno.`,
      500,
      updateError.message
    )
  }

  return Response.json({ ok: true, customer: updatedCustomer })
}
