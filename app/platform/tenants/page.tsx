'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput } from '../../../src/lib/money'
import { getAllowedPlanCodesForBusinessType } from '../../../src/lib/plan-features'

type Tenant = {
  id: string
  status: string
  business_type: string | null
  plan: string
  legal_name: string
  public_name: string | null
  cpf: string
  email: string
  birth_date: string
  whatsapp_e164: string
  asaas_customer_id: string | null
  created_at: string
  updated_at: string
  has_pending_payment: boolean
  platform_billing_profile: {
    id: string
    amount_cents: number
    due_day: number
    status: string
  } | null
  subscription: {
    id: string
    status: string
  } | null
}

type Plan = {
  code: string
  name: string
  monthly_amount_cents: number
  is_active: boolean
}

type TenantForm = {
  legal_name: string
  public_name: string
  cpf: string
  email: string
  admin_email: string
  birth_date: string
  whatsapp_e164: string
  business_type: string
  plan: string
  status: string
  monthly_amount: string
  due_day: string
}

const emptyTenantForm: TenantForm = {
  legal_name: '',
  public_name: '',
  cpf: '',
  email: '',
  admin_email: '',
  birth_date: '',
  whatsapp_e164: '',
  business_type: 'teacher',
  plan: 'plan1',
  status: 'active',
  monthly_amount: '',
  due_day: '',
}

export default function PlatformTenantsPage() {
  const router = useRouter()

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [creatingTenant, setCreatingTenant] = useState(false)
  const [createError, setCreateError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingTenantId, setDeletingTenantId] = useState('')
  const [billingStatusSavingId, setBillingStatusSavingId] = useState('')
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string
    password: string | null
    authUserExisted: boolean
  } | null>(null)
  const [form, setForm] = useState<TenantForm>(emptyTenantForm)

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const headers = {
      Authorization: `Bearer ${session.access_token}`,
    }

    const [response, plansResponse] = await Promise.all([
      fetch('/api/platform/tenants', { headers }),
      fetch('/api/platform/plans', { headers }),
    ])

    if (response.status === 401) {
      router.push('/login')
      return
    }

    if (response.status === 403) {
      setError('Seu usuário não tem permissão de administrador da plataforma.')
      setLoading(false)
      return
    }

    if (!response.ok) {
      setError('Não foi possível carregar os negócios.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setTenants(data.tenants ?? [])

    if (plansResponse.ok) {
      const plansData = await plansResponse.json()
      const activePlans = (plansData.plans ?? []).filter((plan: Plan) => plan.is_active)
      setPlans(activePlans)

      if (activePlans.length > 0) {
        setForm((currentForm) => {
          const allowedCodes = getAllowedPlanCodesForBusinessType(currentForm.business_type)
          const compatiblePlans = activePlans.filter((plan: Plan) => allowedCodes.includes(plan.code))
          const currentPlan = compatiblePlans.find((plan: Plan) => plan.code === currentForm.plan)
          const selectedPlan = currentPlan ?? compatiblePlans[0] ?? activePlans[0]

          return {
            ...currentForm,
            plan: selectedPlan.code,
            monthly_amount: currentForm.monthly_amount || formatCentsAsMoneyInput(selectedPlan.monthly_amount_cents),
          }
        })
      }
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const availablePlans = useMemo(() => {
    const allowedCodes = getAllowedPlanCodesForBusinessType(form.business_type)
    return plans.filter((plan) => allowedCodes.includes(plan.code))
  }, [form.business_type, plans])

  const filteredTenants = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return tenants.filter((tenant) => {
      const matchesStatus =
        statusFilter === 'all' || tenant.status === statusFilter

      const matchesQuery =
        !normalizedQuery ||
        tenant.legal_name.toLowerCase().includes(normalizedQuery) ||
        tenant.email.toLowerCase().includes(normalizedQuery) ||
        tenant.whatsapp_e164.toLowerCase().includes(normalizedQuery) ||
        tenant.cpf.toLowerCase().includes(normalizedQuery)

      return matchesStatus && matchesQuery
    })
  }, [tenants, query, statusFilter])

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function selectBusinessType(businessType: string) {
    const allowedCodes = getAllowedPlanCodesForBusinessType(businessType)
    const nextPlanCode = allowedCodes.includes(form.plan) ? form.plan : allowedCodes[0]
    const selectedPlan = plans.find((plan) => plan.code === nextPlanCode)

    setForm({
      ...form,
      business_type: businessType,
      plan: nextPlanCode,
      monthly_amount: selectedPlan
        ? formatCentsAsMoneyInput(selectedPlan.monthly_amount_cents)
        : form.monthly_amount,
    })
  }

  function selectPlan(planCode: string) {
    const selectedPlan = plans.find((plan) => plan.code === planCode)

    setForm({
      ...form,
      plan: planCode,
      monthly_amount: selectedPlan
        ? formatCentsAsMoneyInput(selectedPlan.monthly_amount_cents)
        : form.monthly_amount,
    })
  }

  async function createTenant(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setCreateError('')
    setCreatedCredentials(null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/platform/tenants', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(form),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const message = data?.message || data?.error || 'Não foi possível criar o negócio.'
      const details = data?.details ? ` Detalhe: ${data.details}` : ''

      setCreateError(`${message}${details}`)
      return
    }

    const data = await response.json()

    setCreatedCredentials({
      email: data.admin_email,
      password: data.temporary_password,
      authUserExisted: data.auth_user_existed,
    })
    setCreatingTenant(false)
    setCreateError('')
    setForm(emptyTenantForm)
    await load()
  }

  async function deleteTenant(tenant: Tenant) {
    const confirmed = confirm(
      `Excluir o negócio ${tenant.legal_name}? Esta ação remove a conta e os dados vinculados.`
    )

    if (!confirmed) return

    setDeletingTenantId(tenant.id)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(`/api/platform/tenants/${tenant.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    setDeletingTenantId('')

    if (!response.ok) {
      setError('Não foi possível excluir o negócio.')
      return
    }

    await load()
  }

  async function updateBillingStatus(
    tenant: Tenant,
    nextStatus: 'active' | 'paused'
  ) {
    const profile = tenant.platform_billing_profile

    if (!profile) {
      setError('Este negócio ainda não tem cobrança da plataforma configurada.')
      return
    }

    const confirmed = confirm(
      nextStatus === 'active'
        ? `Ativar a cobrança de ${tenant.legal_name}?`
        : `Pausar a cobrança de ${tenant.legal_name}?`
    )

    if (!confirmed) return

    setBillingStatusSavingId(profile.id)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setBillingStatusSavingId('')
      router.push('/login')
      return
    }

    const response = await fetch(
      `/api/platform/billing-profiles/${profile.id}/status`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
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

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Negócios</h1>
              <p className="text-sm text-gray-500 mt-1">
                Gerencie professores, clinicas, saloes, restaurantes, lojas, petshops e demais contas da plataforma.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => {
                  setCreateError('')
                  setCreatingTenant(true)
                }}
                className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white"
              >
                Adicionar negócio
              </button>

              <button
                onClick={() => router.push('/platform/signups')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Novas contas pendentes
              </button>

              <button
                onClick={() => router.push('/platform/payments')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Pagamentos pendentes
              </button>

              <button
                onClick={() => router.push('/platform/contact-messages')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Mensagens
              </button>

              <button
                onClick={() => router.push('/platform/whatsapp-inbox')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                WhatsApp do Jack
              </button>

              <button
                onClick={() => router.push('/platform/payment-history')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Historico de pagamentos
              </button>

              <button
                onClick={() => router.push('/platform/plans')}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Planos
              </button>

              <button
                onClick={logout}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
              >
                Sair
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {createdCredentials && (
          <div className="bg-emerald-50 text-emerald-800 rounded-xl p-4 text-sm">
            <p className="font-medium">Negócio criado.</p>
            <p>Email admin: {createdCredentials.email}</p>
            {createdCredentials.password ? (
              <p>Senha temporaria: {createdCredentials.password}</p>
            ) : (
              <p>O Auth User ja existia. A senha nao foi alterada.</p>
            )}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Buscar por nome, CPF, email ou WhatsApp"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="all">Todos os status</option>
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-2 pr-2 font-medium">Negócio</th>
                  <th className="py-2 pr-2 font-medium">Contato</th>
                  <th className="py-2 pr-2 font-medium">Tipo</th>
                  <th className="py-2 pr-2 font-medium">Plano</th>
                  <th className="py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 pr-2 font-medium">Cobrança</th>
                  <th className="py-2 pr-2 font-medium">Pagamento</th>
                  <th className="py-2 pr-2 font-medium">Criado</th>
                  <th className="py-2 text-right font-medium">Acoes</th>
                </tr>
              </thead>

              <tbody>
                {filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-gray-500">
                      Nenhum negócio encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => (
                    <tr key={tenant.id} className="border-b border-gray-100">
                      <td className="py-2 pr-2 font-medium">
                        <div>{tenant.public_name || tenant.legal_name}</div>
                        <div className="text-xs font-normal text-gray-400">
                          {tenant.legal_name} · {tenant.cpf}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-gray-600">
                        <div>{tenant.email}</div>
                        <div className="text-xs text-gray-400">
                          {tenant.whatsapp_e164}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-gray-600">{tenant.business_type ?? 'teacher'}</td>
                      <td className="py-2 pr-2 text-gray-600">{tenant.plan}</td>
                      <td className="py-2 pr-2 text-gray-600">{tenant.status}</td>
                      <td className="py-2 pr-2 text-gray-600">
                        {tenant.platform_billing_profile ? (
                          <div>
                            <div>
                              {formatCurrencyFromCents(tenant.platform_billing_profile.amount_cents)} · dia {tenant.platform_billing_profile.due_day}
                            </div>
                            <div className="text-xs text-gray-400">
                              {tenant.platform_billing_profile.status}
                            </div>
                            <button
                              onClick={() => void updateBillingStatus(
                                tenant,
                                tenant.platform_billing_profile?.status === 'active'
                                  ? 'paused'
                                  : 'active'
                              )}
                              disabled={billingStatusSavingId === tenant.platform_billing_profile.id}
                              className="mt-1 text-xs font-medium text-gray-950 underline disabled:opacity-50"
                            >
                              {billingStatusSavingId === tenant.platform_billing_profile.id
                                ? 'Salvando...'
                                : tenant.platform_billing_profile.status === 'active'
                                  ? 'Pausar'
                                  : 'Ativar'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-amber-700">Sem cobrança</span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <span
                          className={
                            !tenant.platform_billing_profile
                              ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800'
                              : tenant.platform_billing_profile.status !== 'active'
                                ? 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700'
                                : tenant.has_pending_payment
                              ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800'
                              : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800'
                          }
                        >
                          {!tenant.platform_billing_profile
                            ? 'Sem cobrança'
                            : tenant.platform_billing_profile.status !== 'active'
                              ? 'Pausada'
                              : tenant.has_pending_payment
                                ? 'Pendente'
                                : 'Em dia'}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-gray-600">
                        {new Date(tenant.created_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => router.push(`/platform/tenants/${tenant.id}`)}
                            className="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium"
                          >
                            Gerenciar
                          </button>
                          <button
                            onClick={() => void deleteTenant(tenant)}
                            disabled={deletingTenantId === tenant.id}
                            className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 disabled:opacity-50"
                          >
                            {deletingTenantId === tenant.id ? 'Excluindo...' : 'Excluir'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {creatingTenant && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 md:items-center md:justify-center">
          <form
            onSubmit={createTenant}
            className="w-full rounded-2xl bg-white p-5 shadow-xl md:max-w-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Adicionar negócio</h2>
                <p className="text-sm text-gray-500">
                  Crie a conta do cliente e a regra de cobrança mensal.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCreateError('')
                  setCreatingTenant(false)
                }}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm"
              >
                Fechar
              </button>
            </div>

            <div className="grid gap-3">
              {createError && (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {createError}
                </div>
              )}

              <label className="text-sm font-medium">
                Nome completo ou razão social
                <input
                  value={form.legal_name}
                  onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="text-sm font-medium">
                Nome fantasia
                <input
                  value={form.public_name}
                  onChange={(event) => setForm({ ...form, public_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  placeholder="Nome exibido aos clientes no WhatsApp"
                  required
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  CPF/CNPJ
                  <input
                    value={form.cpf}
                    onChange={(event) => setForm({ ...form, cpf: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required
                  />
                </label>

                <label className="text-sm font-medium">
                  Data de nascimento
                  <input
                    value={form.birth_date}
                    onChange={(event) => setForm({ ...form, birth_date: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="date"
                    required
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  E-mail do negócio
                  <input
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="email"
                    required
                  />
                </label>

                <label className="text-sm font-medium">
                  Email admin
                  <input
                    value={form.admin_email}
                    onChange={(event) => setForm({ ...form, admin_email: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="email"
                    placeholder="Se vazio, usa o e-mail do negócio"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  WhatsApp
                  <input
                    value={form.whatsapp_e164}
                    onChange={(event) => setForm({ ...form, whatsapp_e164: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    placeholder="5583999999999"
                    required
                  />
                </label>

                <label className="text-sm font-medium">
                  Tipo de negócio
                  <select
                    value={form.business_type}
                    onChange={(event) => selectBusinessType(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  >
                    <option value="teacher">Professor</option>
                    <option value="autonomous">Autônomo</option>
                    <option value="clinic">Clínica</option>
                    <option value="salon">Salão</option>
                    <option value="restaurant">Restaurante</option>
                    <option value="loja_material">Loja de material de construção</option>
                    <option value="petshop">Petshop</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  Plano
                  <select
                    value={form.plan}
                    onChange={(event) => selectPlan(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required
                  >
                    {availablePlans.length === 0 ? (
                      <option value="">Nenhum plano ativo para este tipo</option>
                    ) : (
                      availablePlans.map((plan) => (
                        <option key={plan.code} value={plan.code}>
                          {plan.name} ({plan.code})
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="text-sm font-medium">
                  Status
                  <select
                    value={form.status}
                    onChange={(event) => setForm({ ...form, status: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  Mensalidade
                  <input
                    value={form.monthly_amount}
                    onChange={(event) => setForm({ ...form, monthly_amount: event.target.value })}
                    onBlur={() => setForm({ ...form, monthly_amount: formatMoneyInput(form.monthly_amount) })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    inputMode="decimal"
                    placeholder="R$ 0,00"
                    required
                  />
                </label>

                <label className="text-sm font-medium">
                  Dia de cobrança
                  <input
                    value={form.due_day}
                    onChange={(event) => setForm({ ...form, due_day: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="number"
                    min="1"
                    max="31"
                    required
                  />
                </label>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-5 w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Criando...' : 'Criar negócio'}
            </button>
          </form>
        </div>
      )}
    </main>
  )
}
