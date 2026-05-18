'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput, parseMoneyToCents } from '../../src/lib/money'

type Group = {
  id: string
  name: string
  description?: string | null
  active_customers_count?: number
}

type BillingProfile = {
  id: string
  status: string | null
  amount_cents: number | null
  due_day: number | null
}

type CreatedCustomerResult =
  | string
  | {
      id?: string
      customer_id?: string
    }
  | Array<{
      id?: string
      customer_id?: string
    }>
  | null

type Student = {
  id: string
  full_name: string
  cpf: string | null
  phone_e164: string
  is_active: boolean
  group_id: string | null
  tenant_customer_groups: Group | Group[] | null
  customer_billing_profiles: BillingProfile[]
}

type StudentForm = {
  full_name: string
  cpf: string
  phone: string
  group_id: string
  amount: string
  billing_day: string
}

const emptyForm: StudentForm = {
  full_name: '',
  cpf: '',
  phone: '',
  group_id: '',
  amount: '',
  billing_day: '',
}

function firstRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null
}

function parseBillingFields(form: StudentForm) {
  const amountInCents = parseMoneyToCents(form.amount)
  const billingDay = Number(form.billing_day)

  if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
    return null
  }

  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
    return null
  }

  return {
    amount_cents: amountInCents,
    due_day: billingDay,
  }
}

function getCreatedCustomerId(data: CreatedCustomerResult) {
  if (typeof data === 'string') return data

  const value = Array.isArray(data) ? data[0] : data

  return value?.customer_id ?? value?.id ?? ''
}

export default function StudentsPage() {
  const router = useRouter()

  const [tenantId, setTenantId] = useState('')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groupSaving, setGroupSaving] = useState(false)
  const [billingStatusSavingId, setBillingStatusSavingId] = useState('')
  const [error, setError] = useState('')
  const [groupError, setGroupError] = useState('')
  const [groupSuccess, setGroupSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [newGroupName, setNewGroupName] = useState('')
  const [showGroupsManager, setShowGroupsManager] = useState(false)
  const [managedGroups, setManagedGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState('')
  const [groupForm, setGroupForm] = useState({ name: '', description: '' })
  const [creatingStudent, setCreatingStudent] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [form, setForm] = useState<StudentForm>(emptyForm)
  const labels = getBusinessLabels(businessType)

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')

    const result = await getCurrentTenantUser()

    if (!result) {
      router.push('/login')
      return
    }

    if (result.tenantUser.must_change_password) {
      router.push('/change-password')
      return
    }

    if (!tenantCanUseBilling(result.tenant?.plan)) {
      router.push('/dashboard')
      return
    }

    setTenantId(result.tenantUser.tenant_id)
    setBusinessType(result.tenant?.business_type ?? null)

    const [groupsResult, studentsResult] = await Promise.all([
      supabase
        .from('tenant_customer_groups')
        .select('id, name')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('tenant_customers')
        .select(`
          id,
          full_name,
          cpf,
          phone_e164,
          is_active,
          group_id,
          tenant_customer_groups (
            id,
            name
          ),
          customer_billing_profiles (
            id,
            status,
            amount_cents,
            due_day
          )
        `)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('is_active', true)
        .order('full_name', { ascending: true }),
    ])

    if (groupsResult.error || studentsResult.error) {
      setError(`Não foi possível carregar ${labels.customerPluralLower} e ${labels.groupPluralLower}.`)
      setLoading(false)
      return
    }

    setGroups((groupsResult.data ?? []) as Group[])
    setStudents((studentsResult.data ?? []) as Student[])
    setLoading(false)
  }, [labels.customerPluralLower, labels.groupPluralLower, router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return students.filter((student) => {
      const matchesQuery =
        !normalizedQuery ||
        student.full_name.toLowerCase().includes(normalizedQuery) ||
        student.phone_e164.toLowerCase().includes(normalizedQuery) ||
        (student.cpf ?? '').toLowerCase().includes(normalizedQuery)

      const matchesGroup =
        groupFilter === 'all' ||
        (groupFilter === 'none' && !student.group_id) ||
        student.group_id === groupFilter

      return matchesQuery && matchesGroup
    })
  }, [students, query, groupFilter])

  function openEditor(student: Student) {
    const billing = student.customer_billing_profiles?.[0]

    setEditingStudent(student)
    setForm({
      full_name: student.full_name,
      cpf: student.cpf ?? '',
      phone: student.phone_e164,
      group_id: student.group_id ?? '',
      amount: formatCentsAsMoneyInput(billing?.amount_cents),
      billing_day: billing?.due_day ? String(billing.due_day) : '',
    })
  }

  function openCreator() {
    setEditingStudent(null)
    setCreatingStudent(true)
    setForm(emptyForm)
  }

  function closeStudentForm() {
    setCreatingStudent(false)
    setEditingStudent(null)
    setForm(emptyForm)
  }

  async function saveBillingProfile(customerId: string, billingProfileId?: string) {
    const billingFields = parseBillingFields(form)

    if (!billingFields) {
      return {
        error: 'Informe uma mensalidade valida e um dia de vencimento entre 1 e 31.',
      }
    }

    if (billingProfileId) {
      const { error: billingError } = await supabase
        .from('customer_billing_profiles')
        .update(billingFields)
        .eq('id', billingProfileId)

      return {
        error: billingError ? 'Não foi possível atualizar a mensalidade.' : '',
      }
    }

    const { error: billingError } = await supabase.rpc(
      'admin_create_billing_profile',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
        p_amount_cents: billingFields.amount_cents,
        p_due_day: billingFields.due_day,
        p_plan_code: null,
        p_plan_label: null,
      }
    )

    return {
        error: billingError ? `Não foi possível criar a cobrança do ${labels.customerSingular.toLowerCase()}.` : '',
    }
  }

  async function createInitialBillingCycle(customerId: string) {
    const { error } = await supabase.rpc(
      'admin_create_initial_customer_billing_cycle',
      {
        p_tenant_id: tenantId,
        p_customer_id: customerId,
      }
    )

    return {
      error: error ? 'Não foi possível criar o pagamento pendente inicial.' : '',
    }
  }

  async function createStudent(event: React.FormEvent) {
    event.preventDefault()

    setSaving(true)
    setError('')

    if (!form.full_name.trim()) {
      setError(`Informe o nome do ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
    }

    if (!form.phone.trim()) {
      setError(`Informe o WhatsApp do ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
    }

    if (!parseBillingFields(form)) {
      setError('Informe uma mensalidade valida e um dia de vencimento entre 1 e 31.')
      setSaving(false)
      return
    }

    const { data: createdStudent, error: studentError } = await supabase.rpc(
      'admin_create_customer',
      {
        p_tenant_id: tenantId,
        p_full_name: form.full_name.trim(),
        p_phone_e164: form.phone.trim(),
        p_email: null,
        p_cpf: form.cpf.trim() || null,
        p_notes: null,
      }
    )

    let createdStudentId = getCreatedCustomerId(createdStudent as CreatedCustomerResult)

    if (!studentError && !createdStudentId) {
      const { data: createdCustomerLookup } = await supabase
        .from('tenant_customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone_e164', form.phone.trim())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      createdStudentId = createdCustomerLookup?.id ?? ''
    }

    if (studentError || !createdStudentId) {
      setError(`Não foi possível adicionar o ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
    }

    if (form.group_id) {
      const { error: moveError } = await supabase.rpc(
        'admin_move_customer_to_group',
        {
          p_customer_id: createdStudentId,
          p_group_id: form.group_id,
        }
      )

      if (moveError) {
        setError(`${labels.customerSingular} criado, mas não foi possível mover para a ${labels.groupSingular.toLowerCase()}.`)
        setSaving(false)
        return
      }
    }

    const billingResult = await saveBillingProfile(createdStudentId)

    if (billingResult.error) {
      setError(`${labels.customerSingular} criado, mas a cobrança não pode ser configurada.`)
      setSaving(false)
      return
    }

    const initialCycleResult = await createInitialBillingCycle(createdStudentId)

    if (initialCycleResult.error) {
      setError(`${labels.customerSingular} criado, mas o pagamento pendente inicial não pode ser criado.`)
      setSaving(false)
      return
    }

    closeStudentForm()
    setSaving(false)
    await load()
  }

  async function saveStudent(event: React.FormEvent) {
    event.preventDefault()

    if (!editingStudent) return

    setSaving(true)
    setError('')

    const { error: studentError } = await supabase
      .from('tenant_customers')
      .update({
        full_name: form.full_name.trim(),
        cpf: form.cpf.trim() || null,
        phone_e164: form.phone.trim(),
        group_id: form.group_id || null,
      })
      .eq('id', editingStudent.id)
      .eq('tenant_id', tenantId)

    if (studentError) {
      setError(`Não foi possível salvar o ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
    }

    const billing = editingStudent.customer_billing_profiles?.[0]
    const billingResult = await saveBillingProfile(editingStudent.id, billing?.id)

    if (billingResult.error) {
      setError(billingResult.error)
      setSaving(false)
      return
    }

    closeStudentForm()
    setSaving(false)
    await load()
  }

  async function createGroup(event: React.FormEvent) {
    event.preventDefault()
    await submitGroup()
  }

  async function submitGroup() {
    if (groupSaving) return

    const name = newGroupName.trim()
    if (!name) {
      setGroupError(`Informe o nome da ${labels.groupSingular.toLowerCase()}.`)
      setGroupSuccess('')
      return
    }

    setGroupSaving(true)
    setGroupError('')
    setGroupSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setGroupSaving(false)
      router.push('/login')
      return
    }

    const response = await fetch('/api/customer-groups', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setGroupError(data?.message || `Não foi possível criar a ${labels.groupSingular.toLowerCase()}.`)
      setGroupSaving(false)
      return
    }

    setNewGroupName('')
    setGroupSuccess(`${labels.groupSingular} criada.`)
    setGroupSaving(false)
    await load()
    if (showGroupsManager) {
      await loadManagedGroups()
    }
  }

  async function getSessionToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token ?? ''
  }

  async function loadManagedGroups() {
    setGroupsLoading(true)
    setGroupError('')

    const token = await getSessionToken()

    if (!token) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/customer-groups', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setGroupsLoading(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setGroupError(data?.message || `Não foi possível listar ${labels.groupPluralLower}.`)
      return
    }

    const data = await response.json()
    setManagedGroups(data.groups ?? [])
  }

  async function openGroupsManager() {
    setShowGroupsManager(true)
    await loadManagedGroups()
  }

  function startEditGroup(group: Group) {
    setEditingGroupId(group.id)
    setGroupForm({
      name: group.name,
      description: group.description ?? '',
    })
  }

  async function saveGroup(groupId: string) {
    const name = groupForm.name.trim()

    if (!name) {
      setGroupError(`Informe o nome da ${labels.groupSingular.toLowerCase()}.`)
      return
    }

    setGroupSaving(true)
    setGroupError('')
    setGroupSuccess('')

    const token = await getSessionToken()

    if (!token) {
      setGroupSaving(false)
      router.push('/login')
      return
    }

    const response = await fetch(`/api/customer-groups/${groupId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(groupForm),
    })

    setGroupSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setGroupError(data?.message || `Não foi possível editar a ${labels.groupSingular.toLowerCase()}.`)
      return
    }

    setEditingGroupId('')
    setGroupForm({ name: '', description: '' })
    setGroupSuccess(`${labels.groupSingular} atualizada.`)
    await load()
    await loadManagedGroups()
  }

  async function deleteGroup(group: Group) {
    const confirmed = confirm(
      `Excluir a ${labels.groupSingular.toLowerCase()} "${group.name}"? Os ${labels.customerPluralLower} dentro dela ficarao sem ${labels.groupSingular.toLowerCase()}.`
    )

    if (!confirmed) return

    setGroupSaving(true)
    setGroupError('')
    setGroupSuccess('')

    const token = await getSessionToken()

    if (!token) {
      setGroupSaving(false)
      router.push('/login')
      return
    }

    const response = await fetch(`/api/customer-groups/${group.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setGroupSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setGroupError(data?.message || `Não foi possível excluir a ${labels.groupSingular.toLowerCase()}.`)
      return
    }

    setGroupSuccess(`${labels.groupSingular} excluida. ${labels.customerPlural} foram mantidos sem ${labels.groupSingular.toLowerCase()}.`)
    if (groupFilter === group.id) {
      setGroupFilter('all')
    }
    await load()
    await loadManagedGroups()
  }

  async function updateBillingStatus(profile: BillingProfile, nextStatus: 'active' | 'paused') {
    const confirmed = confirm(
      nextStatus === 'active'
        ? `Ativar a cobranca deste ${labels.customerSingular.toLowerCase()}?`
        : `Pausar a cobranca deste ${labels.customerSingular.toLowerCase()}?`
    )

    if (!confirmed) return

    setBillingStatusSavingId(profile.id)
    setError('')

    const token = await getSessionToken()

    if (!token) {
      setBillingStatusSavingId('')
      router.push('/login')
      return
    }

    const response = await fetch(
      `/api/customer-billing-profiles/${profile.id}/status`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: nextStatus }),
      }
    )

    setBillingStatusSavingId('')

    if (!response.ok) {
      setError('Não foi possível alterar o status da cobrança.')
      return
    }

    await load()
  }

  async function deactivateStudent(student: Student) {
    const confirmed = confirm(`Desativar ${student.full_name}?`)
    if (!confirmed) return

    const { error: deactivateError } = await supabase.rpc(
      'admin_deactivate_customer',
      {
        p_customer_id: student.id,
        p_reason: 'Desativado pelo painel no cadastro de clientes',
      }
    )

    if (deactivateError) {
      setError(`Não foi possível desativar o ${labels.customerSingular.toLowerCase()}.`)
      return
    }

    await load()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="max-w-6xl mx-auto space-y-4">
        <section className="w-full rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">{labels.customerPlural}</h1>
              <p className="text-sm text-gray-500 mt-1">
                Edite dados, organize em {labels.groupPluralLower} e acompanhe cobrancas ativas.
              </p>
            </div>

            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
              <button
                onClick={openCreator}
                className="h-10 min-w-[144px] rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
              >
                {labels.addCustomer}
              </button>

              <button
                onClick={() => router.push('/inactive-students')}
                className="h-10 min-w-[144px] rounded-lg border border-gray-200 px-4 text-sm font-medium"
              >
                {labels.inactiveCustomers}
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="grid items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="block h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 text-sm leading-5 text-gray-950"
                placeholder="Buscar por nome, CPF ou telefone"
              />

              <select
                value={groupFilter}
                onChange={(event) => setGroupFilter(event.target.value)}
                className="block h-10 w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 text-sm leading-5 text-gray-950"
              >
                <option value="all">Todas as {labels.groupPluralLower}</option>
                <option value="none">Sem {labels.groupSingular.toLowerCase()}</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-sm">
                <thead className="border-b border-gray-200 text-left text-gray-500">
                  <tr>
                    <th className="py-3 pr-4 font-medium">Nome</th>
                    <th className="py-3 pr-4 font-medium">Telefone</th>
                  <th className="py-3 pr-4 font-medium">{labels.groupSingular}</th>
                    <th className="py-3 pr-4 font-medium">Mensalidade</th>
                    <th className="py-3 pr-4 font-medium">Cobrança</th>
                    <th className="py-3 text-right font-medium">Acoes</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">
                        Nenhum {labels.customerSingular.toLowerCase()} ativo encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => {
                      const billing = student.customer_billing_profiles?.[0]

                      return (
                        <tr key={student.id} className="border-b border-gray-100">
                          <td className="py-3 pr-4 font-medium">
                            <div>{student.full_name}</div>
                            <div className="text-xs font-normal text-gray-400">
                              {student.cpf || 'CPF não informado'}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {student.phone_e164 || '-'}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {firstRelation(student.tenant_customer_groups)?.name || `Sem ${labels.groupSingular.toLowerCase()}`}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {formatCurrencyFromCents(billing?.amount_cents)}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {billing ? (
                              <div>
                                <div>{billing.status ?? '-'} · dia {billing.due_day ?? '-'}</div>
                                <button
                                  onClick={() => void updateBillingStatus(
                                    billing,
                                    billing.status === 'active' ? 'paused' : 'active'
                                  )}
                                  disabled={billingStatusSavingId === billing.id}
                                  className="mt-1 text-xs font-medium text-gray-950 underline disabled:opacity-50"
                                >
                                  {billingStatusSavingId === billing.id
                                    ? 'Salvando...'
                                    : billing.status === 'active'
                                      ? 'Pausar cobrança'
                                      : 'Ativar cobrança'}
                                </button>
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => openEditor(student)}
                                className="h-9 rounded-lg border border-gray-200 px-3 text-sm font-medium"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => router.push(`/students/${student.id}/move`)}
                                className="h-9 rounded-lg border border-gray-200 px-3 text-sm font-medium"
                              >
                                Mover
                              </button>
                              <button
                                onClick={() => deactivateStudent(student)}
                                className="h-9 rounded-lg bg-red-50 px-3 text-sm font-medium text-red-700"
                              >
                                Desativar
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="space-y-4">
            <form onSubmit={createGroup} className="space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <div>
                <h2 className="font-bold">{labels.groupPlural}</h2>
                <p className="text-sm text-gray-500">
                  Crie {labels.groupPluralLower} para organizar {labels.customerPluralLower} sem alterar o historico.
                </p>
              </div>

              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                placeholder={`Nome da ${labels.groupSingular.toLowerCase()}`}
              />

              {groupError && (
                <p className="text-sm text-red-600">{groupError}</p>
              )}

              {groupSuccess && (
                <p className="text-sm text-emerald-700">{groupSuccess}</p>
              )}

              <button
                type="button"
                onClick={() => void submitGroup()}
                disabled={groupSaving}
                className="h-10 w-full rounded-lg bg-gray-950 text-sm font-medium text-white disabled:opacity-50"
              >
                {groupSaving ? 'Criando...' : `Criar ${labels.groupSingular.toLowerCase()}`}
              </button>

              <button
                type="button"
                onClick={() => void openGroupsManager()}
                className="h-10 w-full rounded-lg border border-gray-200 text-sm font-medium"
              >
                Listar {labels.groupPluralLower}
              </button>
            </form>

            <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold">Resumo</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">{labels.customerPlural} ativos</dt>
                  <dd className="font-medium">{students.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">{labels.groupPlural}</dt>
                  <dd className="font-medium">{groups.length}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Sem {labels.groupSingular.toLowerCase()}</dt>
                  <dd className="font-medium">
                    {students.filter((student) => !student.group_id).length}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </section>
      </div>

      {(creatingStudent || editingStudent) && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 md:items-center md:justify-center">
          <form
            onSubmit={creatingStudent ? createStudent : saveStudent}
            className="w-full rounded-lg border border-gray-200 bg-white p-5 shadow-xl md:max-w-lg"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">
                  {creatingStudent ? labels.addCustomer : labels.editCustomer}
                </h2>
                <p className="text-sm text-gray-500">
                  {creatingStudent
                    ? `Cadastre o ${labels.customerSingular.toLowerCase()} ja com ${labels.groupSingular.toLowerCase()} e mensalidade.`
                    : 'Alterações ficam vinculadas ao tenant atual.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeStudentForm}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm"
              >
                Fechar
              </button>
            </div>

            <div className="grid gap-3">
              <label className="text-sm font-medium">
                Nome
                <input
                  value={form.full_name}
                  onChange={(event) => setForm({ ...form, full_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  CPF
                  <input
                    value={form.cpf}
                    onChange={(event) => setForm({ ...form, cpf: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  />
                </label>

                <label className="text-sm font-medium">
                  Telefone
                  <input
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required={creatingStudent}
                  />
                </label>
              </div>

              <label className="text-sm font-medium">
                {labels.groupSingular}
                <select
                  value={form.group_id}
                  onChange={(event) => setForm({ ...form, group_id: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                >
                  <option value="">Sem {labels.groupSingular.toLowerCase()}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  Mensalidade
                  <input
                    value={form.amount}
                    onChange={(event) => setForm({ ...form, amount: event.target.value })}
                    onBlur={() => setForm({ ...form, amount: formatMoneyInput(form.amount) })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    inputMode="decimal"
                    placeholder="R$ 0,00"
                    required={creatingStudent}
                  />
                </label>

                <label className="text-sm font-medium">
                  Dia de vencimento
                  <input
                    value={form.billing_day}
                    onChange={(event) => setForm({ ...form, billing_day: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    inputMode="numeric"
                    min="1"
                    max="31"
                    type="number"
                    required={creatingStudent}
                  />
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving
                ? 'Salvando...'
                : creatingStudent
                  ? labels.addCustomer
                  : 'Salvar alterações'}
            </button>
          </form>
        </div>
      )}

      {showGroupsManager && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 md:items-center md:justify-center">
          <div className="w-full rounded-lg border border-gray-200 bg-white p-5 shadow-xl md:max-w-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">{labels.groupPlural}</h2>
                <p className="text-sm text-gray-500">
                  Edite ou exclua {labels.groupPluralLower} sem alterar os cadastros dos {labels.customerPluralLower}.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowGroupsManager(false)}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm"
              >
                Fechar
              </button>
            </div>

            {groupError && (
              <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {groupError}
              </p>
            )}

            {groupSuccess && (
              <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                {groupSuccess}
              </p>
            )}

            <div className="max-h-[65vh] overflow-y-auto divide-y divide-gray-100">
              {groupsLoading ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Carregando {labels.groupPluralLower}...
                </p>
              ) : managedGroups.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Nenhuma {labels.groupSingular.toLowerCase()} cadastrada.
                </p>
              ) : (
                managedGroups.map((group) => (
                  <div key={group.id} className="py-4">
                    {editingGroupId === group.id ? (
                      <div className="space-y-3">
                        <input
                          value={groupForm.name}
                          onChange={(event) => setGroupForm({
                            ...groupForm,
                            name: event.target.value,
                          })}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          placeholder={`Nome da ${labels.groupSingular.toLowerCase()}`}
                        />
                        <input
                          value={groupForm.description}
                          onChange={(event) => setGroupForm({
                            ...groupForm,
                            description: event.target.value,
                          })}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          placeholder="Descricao opcional"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingGroupId('')}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveGroup(group.id)}
                            disabled={groupSaving}
                            className="rounded-lg bg-gray-950 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Salvar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="font-medium">{group.name}</h3>
                          <p className="text-sm text-gray-500">
                            {group.description || 'Sem descricao'} · {group.active_customers_count ?? 0} {labels.customerPluralLower}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => startEditGroup(group)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteGroup(group)}
                            disabled={groupSaving}
                            className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
