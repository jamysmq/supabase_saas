export type BusinessType =
  | 'teacher'
  | 'autonomous'
  | 'clinic'
  | 'salon'
  | 'restaurant'
  | 'loja_material'
  | 'petshop'

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
  },
  loja_material: {
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
  },
  petshop: {
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
  },
}

// Vocabulário do motor de catálogo + pedidos. Restaurante usa "cardápio/itens";
// os demais negócios de varejo (loja de material, petshop, etc.) usam "catálogo/produtos".
export type CatalogLabels = {
  title: string
  itemSingular: string
  itemPlural: string
  pageHint: string
  emptyItems: string
  groupPlaceholder: string
  itemNamePlaceholder: string
  dashboardCatalogDescription: string
  dashboardOrdersDescription: string
}

const restaurantCatalogLabels: CatalogLabels = {
  title: 'Cardápio',
  itemSingular: 'item',
  itemPlural: 'itens',
  pageHint: 'Cadastre os itens que vão alimentar o atendimento de pedidos no WhatsApp.',
  emptyItems: 'Nenhum item cadastrado.',
  groupPlaceholder: 'Bebidas, lanches, combos...',
  itemNamePlaceholder: 'Nome do item',
  dashboardCatalogDescription: 'Cadastre itens, descrições e valores para pedidos via WhatsApp.',
  dashboardOrdersDescription: 'Confirme entregas e pagamentos de pedidos recebidos.',
}

const productCatalogLabels: CatalogLabels = {
  title: 'Catálogo',
  itemSingular: 'produto',
  itemPlural: 'produtos',
  pageHint: 'Cadastre os produtos que vão alimentar o atendimento de pedidos no WhatsApp.',
  emptyItems: 'Nenhum produto cadastrado.',
  groupPlaceholder: 'Categorias, seções, marcas...',
  itemNamePlaceholder: 'Nome do produto',
  dashboardCatalogDescription: 'Cadastre produtos, descrições e valores para pedidos via WhatsApp.',
  dashboardOrdersDescription: 'Confirme entregas e pagamentos de pedidos recebidos.',
}

export function getCatalogLabels(businessType?: string | null): CatalogLabels {
  return businessType === 'restaurant' ? restaurantCatalogLabels : productCatalogLabels
}

export function getBusinessLabels(businessType?: string | null) {
  return labelsByBusinessType[businessType as BusinessType] ?? labelsByBusinessType.teacher
}
