export function tenantCanUseBilling(plan?: string | null) {
  return plan === 'plan1' || plan === 'plan3'
}

export function tenantCanUseAppointments(plan?: string | null) {
  return plan === 'plan2' || plan === 'plan3'
}

export function tenantCanUseRestaurant(plan?: string | null) {
  return plan === 'plan4'
}

export function tenantPlanLabel(plan?: string | null) {
  const labels: Record<string, string> = {
    plan1: 'Plano 1 - Cobranças',
    plan2: 'Plano 2 - Agenda',
    plan3: 'Plano 3 - Cobranças + agenda',
    plan4: 'Plano 4 - Restaurantes',
  }

  return plan ? labels[plan] ?? plan : '-'
}
