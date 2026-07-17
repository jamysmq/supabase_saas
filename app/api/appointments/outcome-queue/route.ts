import { requireTenantUser, tenantCanUseAppointments } from '../../../../src/lib/tenant-admin'

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return Response.json(
      { error: 'Agenda disponível apenas em planos com agenda.' },
      { status: 403 }
    )
  }

  const { data, error } = await result.supabase.rpc(
    'admin_list_appointment_outcome_queue',
    {
      p_tenant_id: result.tenantUser.tenant_id,
      p_now: new Date().toISOString(),
    }
  )

  if (error) {
    return Response.json(
      { error: 'Não foi possível carregar os atendimentos a confirmar.' },
      { status: 500 }
    )
  }

  return Response.json({ appointments: data ?? [] })
}

