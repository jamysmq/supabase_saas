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

export function isTenantPlanBusinessTypeCompatible(
  plan?: string | null,
  businessType?: string | null
) {
  if (plan === 'plan4' || plan === 'plan5') return businessType === 'restaurant'
  if (businessType === 'restaurant') return plan === 'plan4' || plan === 'plan5'
  return true
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
