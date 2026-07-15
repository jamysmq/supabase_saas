'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../src/lib/supabase'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput } from '../../../../src/lib/money'
import { getAllowedPlanCodesForBusinessType } from '../../../../src/lib/plan-features'

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
}

type TenantUser = {
  id: string
  role: string
  email: string
  auth_user_id: string | null
  must_change_password: boolean
  created_at: string
}

type Subscription = {
  id: string
  plan: string
  status: string
  asaas_subscription_id: string | null
  created_at: string
  activated_at: string | null
} | null

type Settings = {
  pix_key: string | null
  pix_key_type: string | null
  pix_beneficiary_name: string | null
  timezone: string | null
  max_customer_groups: number | null
} | null

type BillingProfile = {
  id: string
  amount_cents: number
  due_day: number
  status: string
  currency: string
  created_at: string
  updated_at: string
} | null

type Plan = {
  code: string
  name: string
  is_active: boolean
  monthly_amount_cents: number
  max_customer_groups: number
}

type FormState = {
  legal_name: string
  public_name: string
  cpf: string
  email: string
  birth_date: string
  whatsapp_e164: string
  business_type: string
  plan: string
  status: string
  monthly_amount: string
  due_day: string
}

export default function PlatformTenantDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()

  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [users, setUsers] = useState<TenantUser[]>([])
  const [subscription, setSubscription] = useState<Subscription>(null)
  const [settings, setSettings] = useState<Settings>(null)
  const [billingProfile, setBillingProfile] = useState<BillingProfile>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [form, setForm] = useState<FormState>({
    legal_name: '',
    public_name: '',
    cpf: '',
    email: '',
    birth_date: '',
    whatsapp_e164: '',
    business_type: 'teacher',
    plan: '',
    status: '',
    monthly_amount: '',
    due_day: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [billingSaving, setBillingSaving] = useState(false)
  const [resettingUserId, setResettingUserId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [resetCredentials, setResetCredentials] = useState<{
    email: string
    password: string
  } | null>(null)

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')
    setSuccess('')

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
      fetch(`/api/platform/tenants/${params.id}`, { headers }),
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
      setError('Não foi possível carregar o tenant.')
      setLoading(false)
      return
    }

    const data = await response.json()
    const loadedTenant = data.tenant as Tenant
    const loadedBillingProfile = data.billingProfile as BillingProfile

    setTenant(loadedTenant)
    setUsers(data.users ?? [])
    setSubscription(data.subscription ?? null)
    setSettings(data.settings ?? null)
    setBillingProfile(loadedBillingProfile ?? null)

    if (plansResponse.ok) {
      const plansData = await plansResponse.json()
      setPlans(plansData.plans ?? [])
    }

    setForm({
      legal_name: loadedTenant.legal_name,
      public_name: loadedTenant.public_name ?? loadedTenant.legal_name,
      cpf: loadedTenant.cpf,
      email: loadedTenant.email,
      birth_date: loadedTenant.birth_date,
      whatsapp_e164: loadedTenant.whatsapp_e164,
      business_type: loadedTenant.business_type ?? 'teacher',
      plan: loadedTenant.plan,
      status: loadedTenant.status,
      monthly_amount: formatCentsAsMoneyInput(loadedBillingProfile?.amount_cents),
      due_day: loadedBillingProfile?.due_day ? String(loadedBillingProfile.due_day) : '',
    })
    setLoading(false)
  }, [params.id, router])

  const availablePlans = useMemo(() => {
    const allowedCodes = getAllowedPlanCodesForBusinessType(form.business_type)
    return plans.filter((plan) => allowedCodes.includes(plan.code) || plan.code === form.plan)
  }, [form.business_type, form.plan, plans])

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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(`/api/platform/tenants/${params.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(form),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const message = data?.message || data?.error || 'Não foi possível salvar o tenant.'
      const details = data?.details ? ` Detalhe: ${data.details}` : ''

      setError(`${message}${details}`)
      return
    }

    setSuccess('Tenant atualizado.')
    await load()
  }

  async function resetPassword(user: TenantUser) {
    const confirmed = confirm(`Gerar senha temporaria para ${user.email}?`)

    if (!confirmed) return

    setResettingUserId(user.id)
    setError('')
    setSuccess('')
    setResetCredentials(null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(
      `/api/platform/tenant-users/${user.id}/reset-password`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    )

    setResettingUserId('')

    if (!response.ok) {
      setError('Não foi possível resetar a senha do usuário.')
      return
    }

    const data = await response.json()

    setResetCredentials({
      email: data.email,
      password: data.temporary_password,
    })
    await load()
  }

  async function updateBillingStatus(nextStatus: 'active' | 'paused') {
    if (!billingProfile) {
      setError('Este tenant ainda não tem cobrança da plataforma configurada.')
      return
    }

    const confirmed = confirm(
      nextStatus === 'active'
        ? 'Ativar a cobrança deste tenant?'
        : 'Pausar a cobrança deste tenant?'
    )

    if (!confirmed) return

    setBillingSaving(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setBillingSaving(false)
      router.push('/login')
      return
    }

    const response = await fetch(
      `/api/platform/billing-profiles/${billingProfile.id}/status`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: nextStatus }),
      }
    )

    setBillingSaving(false)

    if (!response.ok) {
      setError('Não foi possível alterar o status da cobrança.')
      return
    }

    setSuccess('Status da cobrança atualizado.')
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
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            onClick={() => router.push('/platform/tenants')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <h1 className="text-2xl font-bold">{tenant?.legal_name}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tenant: {tenant?.id}
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-700 rounded-xl p-4 text-sm">
            {success}
          </div>
        )}

        {resetCredentials && (
          <div className="bg-emerald-50 text-emerald-800 rounded-xl p-4 text-sm">
            <p className="font-medium">Senha temporaria gerada.</p>
            <p>Email: {resetCredentials.email}</p>
            <p>Senha temporaria: {resetCredentials.password}</p>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <form onSubmit={save} className="bg-white rounded-2xl shadow p-5 space-y-4">
            <h2 className="font-bold">Dados do tenant</h2>

            <label className="block text-sm font-medium">
              Nome legal
              <input
                value={form.legal_name}
                onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                required
              />
            </label>

            <label className="block text-sm font-medium">
              Nome fantasia
              <input
                value={form.public_name}
                onChange={(event) => setForm({ ...form, public_name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                placeholder="Nome curto exibido aos clientes no WhatsApp"
                required
              />
              <span className="mt-1 block text-xs font-normal text-gray-500">
                Este é o nome mostrado na busca e nas mensagens do Assistente Jack.
              </span>
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                CPF/CNPJ
                <input
                  value={form.cpf}
                  onChange={(event) => setForm({ ...form, cpf: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                WhatsApp
                <input
                  value={form.whatsapp_e164}
                  onChange={(event) => setForm({ ...form, whatsapp_e164: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Email
                <input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="email"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Nascimento
                <input
                  value={form.birth_date}
                  onChange={(event) => setForm({ ...form, birth_date: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="date"
                  required
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Plano
                <select
                  value={form.plan}
                  onChange={(event) => selectPlan(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                >
                  {availablePlans.map((plan) => (
                    <option key={plan.code} value={plan.code} disabled={!plan.is_active && plan.code !== form.plan}>
                      {plan.name} ({plan.code}){plan.is_active ? '' : ' - inativo'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
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
                </select>
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                >
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>

              <label className="block text-sm font-medium">
                Mensalidade individual
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
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium">
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

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar tenant'}
            </button>
          </form>

          <aside className="space-y-4">
            <section className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold">Assinatura</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Plano</dt>
                  <dd className="font-medium">{subscription?.plan ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Status</dt>
                  <dd className="font-medium">{subscription?.status ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Asaas</dt>
                  <dd className="font-medium text-right">
                    {subscription?.asaas_subscription_id ?? '-'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="bg-white rounded-2xl shadow p-5">
              <h2 className="font-bold">Cobrança</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Mensalidade</dt>
                  <dd className="font-medium">{formatCurrencyFromCents(billingProfile?.amount_cents)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Vencimento</dt>
                  <dd className="font-medium">
                    {billingProfile ? `Dia ${billingProfile.due_day}` : '-'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Status</dt>
                  <dd className="font-medium">{billingProfile?.status ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Pix</dt>
                  <dd className="font-medium text-right">{settings?.pix_key ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Timezone</dt>
                  <dd className="font-medium">{settings?.timezone ?? '-'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Max grupos</dt>
                  <dd className="font-medium">{settings?.max_customer_groups ?? '-'}</dd>
                </div>
              </dl>
              {billingProfile && (
                <button
                  onClick={() => void updateBillingStatus(
                    billingProfile.status === 'active' ? 'paused' : 'active'
                  )}
                  disabled={billingSaving}
                  className="mt-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {billingSaving
                    ? 'Salvando...'
                    : billingProfile.status === 'active'
                      ? 'Pausar cobrança'
                      : 'Ativar cobrança'}
                </button>
              )}
            </section>
          </aside>
        </section>

        <section className="bg-white rounded-2xl shadow p-5">
          <h2 className="font-bold mb-3">Usuários do tenant</h2>
          <div className="divide-y divide-gray-100">
            {users.length === 0 ? (
              <p className="py-6 text-sm text-gray-500">
                Nenhum usuário vinculado.
              </p>
            ) : (
              users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-medium">{user.email}</p>
                    <p className="text-sm text-gray-500">
                      {user.role} · {user.auth_user_id ? 'Auth criado' : 'Sem auth'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 md:items-end">
                    <p className="text-sm text-gray-500">
                      {user.must_change_password ? 'Troca de senha pendente' : 'Senha liberada'}
                    </p>
                    <button
                      onClick={() => void resetPassword(user)}
                      disabled={resettingUserId === user.id}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {resettingUserId === user.id ? 'Resetando...' : 'Resetar senha'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
