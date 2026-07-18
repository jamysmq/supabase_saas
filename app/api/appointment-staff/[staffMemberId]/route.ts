import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ staffMemberId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { staffMemberId } = await context.params
  const body = await request.json().catch(() => null)
  const name = String(body?.name ?? '').trim()
  const role = String(body?.role ?? body?.notes ?? '').trim() || null

  if (!name) {
    return errorResponse('Informe o nome do profissional.')
  }

  const { data, error } = await result.supabase
    .from('tenant_staff_members')
    .update({
      name,
      role,
      updated_at: new Date().toISOString(),
    })
    .eq('id', staffMemberId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Não foi possível atualizar o profissional.', error?.code === 'PGRST116' ? 404 : 500, error?.message)
  }

  return Response.json({ ok: true })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ staffMemberId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponível apenas em planos com agenda.', 403)
  }

  const { staffMemberId } = await context.params

  const { data, error } = await result.supabase
    .rpc('admin_remove_tenant_staff_member', {
      p_tenant_id: result.tenantUser.tenant_id,
      p_staff_member_id: staffMemberId,
      p_tenant_user_id: result.tenantUser.id,
    })
    .single()

  if (error || !data) {
    if (error?.message?.includes('staff_has_future_appointments')) {
      return errorResponse(
        'Este profissional possui agendamentos futuros. Mova ou cancele esses horários antes de excluí-lo.',
        409
      )
    }

    if (error?.message?.includes('staff_member_not_found')) {
      return errorResponse('Profissional não encontrado.', 404)
    }

    return errorResponse('Não foi possível excluir o profissional.', 500, error?.message)
  }

  const removal = data as {
    charge_next_billing: boolean
    charge_amount_cents: number
    total_amount_cents: number
  }
  const chargeNextBilling = Boolean(removal.charge_next_billing)
  return Response.json({
    ok: true,
    removal,
    message: chargeNextBilling
      ? 'Profissional excluído. Como permaneceu ativo por mais de 15 dias, o adicional de R$ 25,00 será cobrado uma última vez na próxima mensalidade.'
      : 'Profissional excluído. O adicional não será cobrado na próxima mensalidade.',
  })
}
