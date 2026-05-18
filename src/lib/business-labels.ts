export type BusinessType = 'teacher' | 'autonomous' | 'clinic' | 'salon' | 'restaurant'

export type BusinessLabels = {
  customerSingular: string
  customerPlural: string
  customerPluralLower: string
  inactiveCustomers: string
  addCustomer: string
  editCustomer: string
  groupSingular: string
  groupPlural: string
  groupPluralLower: string
  dashboardCustomersDescription: string
  dashboardInactiveDescription: string
  billingTitle: string
  billingDescription: string
}

const labelsByBusinessType: Record<BusinessType, BusinessLabels> = {
  teacher: {
    customerSingular: 'Aluno',
    customerPlural: 'Alunos',
    customerPluralLower: 'alunos',
    inactiveCustomers: 'Alunos inativos',
    addCustomer: 'Adicionar aluno',
    editCustomer: 'Editar aluno',
    groupSingular: 'Turma',
    groupPlural: 'Turmas',
    groupPluralLower: 'turmas',
    dashboardCustomersDescription: 'Cadastre, edite, mova entre turmas e gerencie cobranças.',
    dashboardInactiveDescription: 'Consulte cadastros pausados e reative quando necessário.',
    billingTitle: 'Mensalidades',
    billingDescription: 'Ajuste valor e vencimento por aluno.',
  },
  autonomous: {
    customerSingular: 'Cliente',
    customerPlural: 'Clientes',
    customerPluralLower: 'clientes',
    inactiveCustomers: 'Clientes inativos',
    addCustomer: 'Adicionar cliente',
    editCustomer: 'Editar cliente',
    groupSingular: 'Grupo',
    groupPlural: 'Grupos',
    groupPluralLower: 'grupos',
    dashboardCustomersDescription: 'Cadastre, edite, organize em grupos e gerencie cobranças.',
    dashboardInactiveDescription: 'Consulte clientes pausados e reative quando necessário.',
    billingTitle: 'Mensalidades',
    billingDescription: 'Ajuste valor e vencimento por cliente.',
  },
  clinic: {
    customerSingular: 'Paciente',
    customerPlural: 'Pacientes',
    customerPluralLower: 'pacientes',
    inactiveCustomers: 'Pacientes inativos',
    addCustomer: 'Adicionar paciente',
    editCustomer: 'Editar paciente',
    groupSingular: 'Grupo',
    groupPlural: 'Grupos',
    groupPluralLower: 'grupos',
    dashboardCustomersDescription: 'Cadastre, edite, organize em grupos e gerencie cobranças.',
    dashboardInactiveDescription: 'Consulte pacientes pausados e reative quando necessário.',
    billingTitle: 'Mensalidades',
    billingDescription: 'Ajuste valor e vencimento por paciente.',
  },
  salon: {
    customerSingular: 'Cliente',
    customerPlural: 'Clientes',
    customerPluralLower: 'clientes',
    inactiveCustomers: 'Clientes inativos',
    addCustomer: 'Adicionar cliente',
    editCustomer: 'Editar cliente',
    groupSingular: 'Grupo',
    groupPlural: 'Grupos',
    groupPluralLower: 'grupos',
    dashboardCustomersDescription: 'Cadastre, edite, organize em grupos e gerencie cobranças.',
    dashboardInactiveDescription: 'Consulte clientes pausados e reative quando necessário.',
    billingTitle: 'Mensalidades',
    billingDescription: 'Ajuste valor e vencimento por cliente.',
  },
  restaurant: {
    customerSingular: 'Cliente',
    customerPlural: 'Clientes',
    customerPluralLower: 'clientes',
    inactiveCustomers: 'Clientes inativos',
    addCustomer: 'Adicionar cliente',
    editCustomer: 'Editar cliente',
    groupSingular: 'Grupo',
    groupPlural: 'Grupos',
    groupPluralLower: 'grupos',
    dashboardCustomersDescription: 'Cadastre clientes e mantenha dados de contato organizados.',
    dashboardInactiveDescription: 'Consulte clientes pausados e reative quando necessário.',
    billingTitle: 'Cobranças',
    billingDescription: 'Acompanhe valores e vencimentos quando o módulo financeiro estiver ativo.',
  },
}

export function getBusinessLabels(businessType?: string | null) {
  return labelsByBusinessType[businessType as BusinessType] ?? labelsByBusinessType.teacher
}
