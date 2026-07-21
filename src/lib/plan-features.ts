export function tenantCanUseBilling(plan?: string | null) {
  return plan === 'plan1' || plan === 'plan3'
}

export function tenantCanUseAppointments(plan?: string | null) {
  return plan === 'plan2' || plan === 'plan3'
}

// Motor de catálogo + pedidos (ex-"restaurante"). Disponível nos planos 4 e 5.
export function tenantCanUseCatalog(plan?: string | null) {
  return plan === 'plan4' || plan === 'plan5'
}

// Mantido como alias retrocompatível enquanto rotas/templates antigos ainda o referenciam.
export function tenantCanUseRestaurant(plan?: string | null) {
  return tenantCanUseCatalog(plan)
}

export function tenantCanUseSalonInventory(
  plan?: string | null,
  businessType?: string | null
) {
  return businessType === 'salon' && tenantCanUseAppointments(plan)
}

export function tenantCanUseInventory(
  plan?: string | null,
  businessType?: string | null
) {
  return tenantCanUseCatalog(plan) || tenantCanUseSalonInventory(plan, businessType)
}

export function tenantCanUseTableReservations(plan?: string | null) {
  return plan === 'plan5'
}

const allowedPlanCodesByBusinessType: Record<string, string[]> = {
  teacher: ['plan1', 'plan3'],
  autonomous: ['plan2', 'plan3'],
  clinic: ['plan2', 'plan3'],
  salon: ['plan2', 'plan3'],
  arena: ['plan3'],
  academy: ['plan3'],
  restaurant: ['plan4', 'plan5'],
  loja_material: ['plan4', 'plan5'],
  petshop: ['plan4', 'plan5'],
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
    plan4: 'Plano 4 - Catálogo e pedidos',
    plan5: 'Plano 5 - Catálogo e pedidos + reservas',
  }

  return plan ? labels[plan] ?? plan : '-'
}
