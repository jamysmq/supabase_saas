export function tenantCanUseBilling(plan?: string | null) {
  return plan === 'plan1' || plan === 'plan3'
}

export function tenantCanUseAppointments(plan?: string | null) {
  return plan === 'plan2' || plan === 'plan3'
}

export function tenantCanUseRestaurant(plan?: string | null) {
  return plan === 'plan4' || plan === 'plan5'
}

export function tenantCanUseTableReservations(plan?: string | null) {
  return plan === 'plan5'
}

const allowedPlanCodesByBusinessType: Record<string, string[]> = {
  teacher: ['plan1', 'plan3'],
  autonomous: ['plan2', 'plan3'],
  clinic: ['plan2', 'plan3'],
  salon: ['plan2', 'plan3'],
  restaurant: ['plan4', 'plan5'],
}

export function getAllowedPlanCodesForBusinessType(businessType?: string | null) {
  return allowedPlanCodesByBusinessType[businessType ?? ''] ?? allowedPlanCodesByBusinessType.teacher
}

export function isTenantPlanBusinessTypeCompatible(
  plan?: string | null,
  businessType?: string | null
) {
  if (!plan) return false
  return getAllowedPlanCodesForBusinessType(businessType).includes(plan)
}

export function tenantPlanLabel(plan?: string | null) {
  const labels: Record<string, string> = {
    plan1: 'Plano 1 - Cobranças',
    plan2: 'Plano 2 - Agenda',
    plan3: 'Plano 3 - Cobranças + agenda',
    plan4: 'Plano 4 - Restaurantes',
    plan5: 'Plano 5 - Restaurantes + reservas',
  }

  return plan ? labels[plan] ?? plan : '-'
}
