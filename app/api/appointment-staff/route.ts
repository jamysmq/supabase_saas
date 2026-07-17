import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const [staffResult, requestsResult] = await Promise.all([
    result.supabase
      .from('tenant_staff_members')
      .select('id, name, role, phone_e164, email, is_active, created_at, updated_at')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    result.supabase
      .from('tenant_staff_addition_requests')
      .select('id, name, role, status, additional_amount_cents, created_at')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  ])

  if (staffResult.error || requestsResult.error) {
    return errorResponse(
      'Não foi possível listar profissionais.',
      500,
      staffResult.error?.message ?? requestsResult.error?.message
    )
  }

  return Response.json({
    staff: staffResult.data ?? [],
    pendingRequests: requestsResult.data ?? [],
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const role = String(body?.role ?? body?.notes ?? '').trim() || null

  if (!name) {
    return errorResponse('Informe o nome do profissional.')
  }

  const requiresApproval =
    result.tenant.business_type === 'salon' &&
    ['plan2', 'plan3'].includes(result.tenant.plan)

  if (requiresApproval) {
    const { count, error: countError } = await result.supabase
      .from('tenant_staff_members')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)

    if (countError) {
      return errorResponse('Não foi possível verificar os profissionais atuais.', 500, countError.message)
    }

    if ((count ?? 0) >= 1) {
      const { data: pendingRequest, error: requestError } = await result.supabase
        .from('tenant_staff_addition_requests')
        .insert({
          tenant_id: result.tenantUser.tenant_id,
          requested_by_tenant_user_id: result.tenantUser.id,
          name,
          role,
          status: 'pending',
          additional_amount_cents: 2500,
        })
        .select('id, name, role, status, additional_amount_cents, created_at')
        .single()

      if (requestError || !pendingRequest) {
        const duplicate = requestError?.code === '23505'
        return errorResponse(
          duplicate
            ? 'Já existe uma solicitação pendente para esse profissional.'
            : 'Não foi possível enviar a solicitação para aprovação.',
          duplicate ? 409 : 500,
          requestError?.message
        )
      }

      return Response.json(
        {
          pendingApproval: true,
          request: pendingRequest,
          message: 'Solicitação enviada à Soft Ink para aprovação.',
        },
        { status: 202 }
      )
    }
  }

  const { data, error } = await result.supabase
    .from('tenant_staff_members')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      name,
      role,
      is_active: true,
    })
    .select('id, name, role, phone_e164, email, is_active, created_at, updated_at')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível criar o profissional.', 500, error?.message)
  }

  return Response.json({
    staffMember: data,
    pendingApproval: false,
    message: 'Primeiro profissional incluído na mensalidade.',
  })
}
