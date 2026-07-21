'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput, parseMoneyToCents } from '../../src/lib/money'
import { InactiveStudentsPanel } from '../inactive-students/page'
import { SignupSettingsPanel } from '../signup-settings/page'

type Group = {
  id: string
  name: string
  description?: string | null
  active_customers_count?: number
  max_members?: number | null
}

type BillingProfile = {
  id: string
  status: string | null
  amount_cents: number | null
  due_day: number | null
  plan_code: string | null
  plan_label: string | null
}

type SignupPlan = {
  id: string
  name: string
  amount_cents: number
  due_day: number
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
  signup_plan_id: string
  amount: string
  billing_day: string
}

const emptyForm: StudentForm = {
  full_name: '',
  cpf: '',
  phone: '',
  group_id: '',
  signup_plan_id: '',
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
  const [signupPlans, setSignupPlans] = useState<SignupPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [groupSaving, setGroupSaving] = useState(false)
  const [billingStatusSavingId, setBillingStatusSavingId] = useState('')
  const [studentStatusSavingId, setStudentStatusSavingId] = useState('')
  const [error, setError] = useState('')
  const [groupError, setGroupError] = useState('')
  const [groupSuccess, setGroupSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMaxMembers, setNewGroupMaxMembers] = useState('')
  const [showGroupsManager, setShowGroupsManager] = useState(false)
  const [managedGroups, setManagedGroups] = useState<Group[]>([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState('')
  const [groupForm, setGroupForm] = useState({ name: '', description: '', max_members: '' })
  const [creatingStudent, setCreatingStudent] = useState(false)
  const [managementView, setManagementView] = useState<'active' | 'inactive' | 'plans'>('active')
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

    const [groupsResult, studentsResult, signupPlansResult] = await Promise.all([
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
            due_day,
            plan_code,
            plan_label
          )
        `)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('is_active', true)
        .order('full_name', { ascending: true }),
      supabase
        .from('tenant_customer_signup_plans')
        .select('id, name, amount_cents, due_day')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
    ])

    if (groupsResult.error || studentsResult.error || signupPlansResult.error) {
      setError(`Não foi possível carregar ${labels.customerPluralLower} e ${labels.groupPluralLower}.`)
      setLoading(false)
      return
    }

    setGroups((groupsResult.data ?? []) as Group[])
    setStudents((studentsResult.data ?? []) as Student[])
    setSignupPlans((signupPlansResult.data ?? []) as SignupPlan[])
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
      signup_plan_id: signupPlans.some((plan) => plan.id === billing?.plan_code) ? billing?.plan_code ?? '' : '',
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
    const selectedPlan = signupPlans.find((plan) => plan.id === form.signup_plan_id)
    const billingFields = selectedPlan
      ? { amount_cents: selectedPlan.amount_cents, due_day: selectedPlan.due_day }
      : parseBillingFields(form)

    if (!billingFields) {
      return {
        error: 'Informe uma mensalidade valida e um dia de vencimento entre 1 e 31.',
      }
    }

    if (billingProfileId) {
      const { error: billingError } = await supabase
        .from('customer_billing_profiles')
        .update({
          ...billingFields,
          plan_code: selectedPlan?.id ?? null,
          plan_label: selectedPlan?.name ?? null,
        })
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
        p_plan_code: selectedPlan?.id ?? null,
        p_plan_label: selectedPlan?.name ?? null,
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

    if (!signupPlans.some((plan) => plan.id === form.signup_plan_id) && !parseBillingFields(form)) {
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
      body: JSON.stringify({ name, max_members: newGroupMaxMembers || null }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setGroupError(data?.message || `Não foi possível criar a ${labels.groupSingular.toLowerCase()}.`)
      setGroupSaving(false)
      return
    }

    setNewGroupName('')
    setNewGroupMaxMembers('')
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
      max_members: group.max_members ? String(group.max_members) : '',
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
    setGroupForm({ name: '', description: '', max_members: '' })
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

    setStudentStatusSavingId(student.id)
    setError('')

    const token = await getSessionToken()

    if (!token) {
      setStudentStatusSavingId('')
      router.push('/login')
      return
    }

    const response = await fetch(`/api/tenant-customers/${student.id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    })

    setStudentStatusSavingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || `Não foi possível desativar o ${labels.customerSingular.toLowerCase()}.`)
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
              <h1 className="text-2xl font-bold">Gerenciamento dos {labels.customerPluralLower}</h1>
              <p className="text-sm text-gray-500 mt-1">
                Consulte ativos e inativos, organize {labels.groupPluralLower} e configure mensalidades.
              </p>
            </div>

            {managementView === 'active' && <div className="w-full sm:w-auto">
              <button
                onClick={openCreator}
                className="h-10 min-w-[144px] rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
              >
                {labels.addCustomer}
              </button>

            </div>}
          </div>
        </section>

        <nav className={`grid gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm ${businessType === 'teacher' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} aria-label="Seções do gerenciamento dos alunos">
          <button type="button" onClick={() => setManagementView('active')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${managementView === 'active' ? 'bg-sky-700 text-white' : 'text-gray-600 hover:bg-sky-50'}`}>
            {labels.customerPlural} ativos
          </button>
          <button type="button" onClick={() => setManagementView('inactive')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${managementView === 'inactive' ? 'bg-sky-700 text-white' : 'text-gray-600 hover:bg-sky-50'}`}>
            {labels.inactiveCustomers}
          </button>
          {businessType === 'teacher' && (
            <button type="button" onClick={() => setManagementView('plans')} className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${managementView === 'plans' ? 'bg-sky-700 text-white' : 'text-gray-600 hover:bg-sky-50'}`}>
              Planos e mensalidades
            </button>
          )}
        </nav>

        {managementView === 'active' ? <>
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

            <div className="space-y-3 md:hidden">
              {filteredStudents.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  Nenhum {labels.customerSingular.toLowerCase()} ativo encontrado.
                </p>
              ) : (
                filteredStudents.map((student) => {
                  const billing = student.customer_billing_profiles?.[0]

                  return (
                    <article key={student.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-words font-semibold">{student.full_name}</h3>
                          <p className="mt-1 text-xs text-gray-500">{student.cpf || 'CPF não informado'}</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold">
                          {formatCurrencyFromCents(billing?.amount_cents)}
                        </span>
                      </div>

                      <dl className="mt-2 grid gap-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-gray-500">Telefone</dt>
                          <dd className="text-right">{student.phone_e164 || '-'}</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-gray-500">{labels.groupSingular}</dt>
                          <dd className="text-right">
                            {firstRelation(student.tenant_customer_groups)?.name || `Sem ${labels.groupSingular.toLowerCase()}`}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-gray-500">Cobrança</dt>
                          <dd className="text-right">{billing ? `${billing.status ?? '-'} · dia ${billing.due_day ?? '-'}` : '-'}</dd>
                        </div>
                      </dl>

                      {billing && (
                        <button
                          onClick={() => void updateBillingStatus(
                            billing,
                            billing.status === 'active' ? 'paused' : 'active'
                          )}
                          disabled={billingStatusSavingId === billing.id}
                          className="mt-3 text-xs font-medium text-gray-950 underline disabled:opacity-50"
                        >
                          {billingStatusSavingId === billing.id
                            ? 'Salvando...'
                            : billing.status === 'active'
                              ? 'Pausar cobrança'
                              : 'Ativar cobrança'}
                        </button>
                      )}

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => openEditor(student)}
                          className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => router.push(`/students/${student.id}/move`)}
                          className="h-10 rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                        >
                          Mover
                        </button>
                        <button
                          onClick={() => void deactivateStudent(student)}
                          disabled={studentStatusSavingId === student.id}
                          className="col-span-2 h-10 rounded-lg border border-red-100 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                        >
                          {studentStatusSavingId === student.id ? 'Desativando...' : 'Desativar'}
                        </button>
                      </div>
                    </article>
                  )
                })
              )}
            </div>

            <div className="hidden md:block">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[27%]" />
                  <col className="w-[17%]" />
                  <col className="w-[15%]" />
                  <col className="w-[18%]" />
                  <col className="w-[23%]" />
                </colgroup>
                <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <tr>
                    <th className="py-2.5 pr-3 font-semibold">{labels.customerSingular}</th>
                    <th className="py-2.5 pr-3 font-semibold">{labels.groupSingular}</th>
                    <th className="py-2.5 pr-3 font-semibold">Mensalidade</th>
                    <th className="py-2.5 pr-3 font-semibold">Cobrança</th>
                    <th className="py-2.5 text-right font-semibold">Ações</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">
                        Nenhum {labels.customerSingular.toLowerCase()} ativo encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => {
                      const billing = student.customer_billing_profiles?.[0]

                      return (
                        <tr key={student.id} className="border-b border-gray-100 align-middle hover:bg-gray-50">
                          <td className="min-w-0 py-2 pr-3 font-medium">
                            <div className="truncate">{student.full_name}</div>
                            <div className="mt-0.5 truncate text-xs font-normal text-gray-500">
                              {student.phone_e164 || 'Sem telefone'}
                            </div>
                            <div className="mt-0.5 truncate text-xs font-normal text-gray-400">
                              {student.cpf || 'CPF não informado'}
                            </div>
                          </td>
                          <td className="min-w-0 py-2 pr-3 text-gray-600">
                            <div className="truncate">{firstRelation(student.tenant_customer_groups)?.name || `Sem ${labels.groupSingular.toLowerCase()}`}</div>
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 font-medium text-gray-700">
                            {formatCurrencyFromCents(billing?.amount_cents)}
                          </td>
                          <td className="py-2 pr-3 text-gray-600">
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
                          <td className="py-2 text-right">
                            <div className="ml-auto grid max-w-[180px] grid-cols-2 gap-1.5">
                              <button
                                onClick={() => openEditor(student)}
                                className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => router.push(`/students/${student.id}/move`)}
                                className="h-8 rounded-md border border-sky-200 bg-sky-50 px-2 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                              >
                                Mover
                              </button>
                              <button
                                onClick={() => void deactivateStudent(student)}
                                disabled={studentStatusSavingId === student.id}
                                className="col-span-2 h-8 rounded-md border border-red-100 bg-red-50 px-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
                              >
                                {studentStatusSavingId === student.id ? 'Desativando...' : 'Desativar'}
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

              <input
                value={newGroupMaxMembers}
                onChange={(event) => setNewGroupMaxMembers(event.target.value)}
                className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
                placeholder="Capacidade máxima (opcional)"
                inputMode="numeric"
                min="1"
                type="number"
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
        </> : managementView === 'inactive' ? (
          <InactiveStudentsPanel embedded />
        ) : (
          <SignupSettingsPanel embedded />
        )}
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
                    : 'As alterações ficam vinculadas ao seu negócio.'}
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

              {businessType === 'teacher' && (
                <label className="text-sm font-medium">
                  Plano de mensalidade
                  <select
                    value={form.signup_plan_id}
                    onChange={(event) => {
                      const signupPlanId = event.target.value
                      const selectedPlan = signupPlans.find((plan) => plan.id === signupPlanId)
                      setForm({
                        ...form,
                        signup_plan_id: signupPlanId,
                        amount: selectedPlan ? formatCentsAsMoneyInput(selectedPlan.amount_cents) : form.amount,
                        billing_day: selectedPlan ? String(selectedPlan.due_day) : form.billing_day,
                      })
                    }}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  >
                    <option value="">Sem plano — definir valor manualmente</option>
                    {signupPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {formatCurrencyFromCents(plan.amount_cents)} · vence dia {plan.due_day}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs font-normal text-gray-500">Ao selecionar um plano, valor e vencimento são preenchidos automaticamente.</span>
                </label>
              )}

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
                    disabled={Boolean(form.signup_plan_id)}
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
                    disabled={Boolean(form.signup_plan_id)}
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
                        <input
                          value={groupForm.max_members}
                          onChange={(event) => setGroupForm({
                            ...groupForm,
                            max_members: event.target.value,
                          })}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          placeholder="Capacidade máxima (opcional)"
                          inputMode="numeric"
                          min="1"
                          type="number"
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
                            {group.description || 'Sem descrição'} · {group.active_customers_count ?? 0}
                            {group.max_members ? ` de ${group.max_members}` : ''} {labels.customerPluralLower}
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
