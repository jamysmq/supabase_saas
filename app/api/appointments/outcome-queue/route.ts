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
      { error: 'Não foi possível carregar os agendamentos pendentes.' },
      { status: 500 }
    )
  }

  const appointments = data ?? []
  const appointmentIds = appointments.map(
    (appointment: { appointment_id: string }) => appointment.appointment_id
  )
  let resourceByAppointmentId = new Map<string, {
    bookable_resource_id: string | null
    bookable_resource_name: string | null
  }>()

  if (appointmentIds.length > 0) {
    const { data: resourceAppointments, error: resourceError } = await result.supabase
      .from('appointments')
      .select('id, bookable_resource_id, bookable_resource_name_snapshot, tenant_bookable_resources(name)')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .in('id', appointmentIds)

    if (resourceError) {
      return Response.json(
        { error: 'Não foi possível carregar os ambientes dos agendamentos pendentes.' },
        { status: 500 }
      )
    }

    resourceByAppointmentId = new Map((resourceAppointments ?? []).map((appointment) => {
      const relation = appointment.tenant_bookable_resources as unknown as { name?: string } | null
      return [appointment.id, {
        bookable_resource_id: appointment.bookable_resource_id,
        bookable_resource_name: appointment.bookable_resource_name_snapshot || relation?.name || null,
      }]
    }))
  }

  return Response.json({
    appointments: appointments.map((appointment: { appointment_id: string }) => ({
      ...appointment,
      ...(resourceByAppointmentId.get(appointment.appointment_id) ?? {
        bookable_resource_id: null,
        bookable_resource_name: null,
      }),
    })),
  })
}
