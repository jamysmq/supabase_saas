import { requireTenantUser, tenantCanUseBilling } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.business_type !== 'teacher' || !tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cadastros pendentes estão disponíveis apenas para contas de professor com cobranças.', 403)
  }

  const { requestId } = await context.params
  const body = await request.json().catch(() => null)
  const action = body?.action

  if (action !== 'approve' && action !== 'reject') {
    return errorResponse('Ação inválida.')
  }

  const rpcName = action === 'approve'
    ? 'admin_approve_teacher_customer_signup_with_group'
    : 'admin_reject_teacher_customer_signup'

  const rpcArgs: Record<string, string | null> = {
    p_tenant_id: result.tenantUser.tenant_id,
    p_request_id: requestId,
    p_reviewed_by_tenant_user_id: result.tenantUser.id,
  }

  if (action === 'approve') {
    rpcArgs.p_group_id = typeof body?.group_id === 'string' && body.group_id ? body.group_id : null
  }

  const { data, error } = await result.supabase.rpc(rpcName, rpcArgs)

  if (error) {
    if (action === 'approve' && error.message.includes('group_is_full')) {
      return errorResponse('A turma escolhida acabou de atingir a capacidade máxima. Selecione outra turma ou aprove sem turma.', 409)
    }

    return errorResponse(
      action === 'approve'
        ? 'Não foi possível aprovar o cadastro.'
        : 'Não foi possível recusar o cadastro.',
      400,
      error.message
    )
  }

  return Response.json({ ok: true, action, result: data })
}
