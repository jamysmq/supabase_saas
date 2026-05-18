'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput } from '../../../src/lib/money'

type Plan = {
  code: string
  name: string
  description: string | null
  monthly_amount_cents: number
  max_customer_groups: number
  is_active: boolean
  sort_order: number
}

type PlanForm = {
  code: string
  name: string
  description: string
  monthly_amount: string
  max_customer_groups: string
  sort_order: string
  is_active: boolean
}

const emptyForm: PlanForm = {
  code: '',
  name: '',
  description: '',
  monthly_amount: '',
  max_customer_groups: '20',
  sort_order: '0',
  is_active: true,
}

export default function PlatformPlansPage() {
  const router = useRouter()

  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingCode, setEditingCode] = useState('')
  const [form, setForm] = useState<PlanForm>(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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

    const response = await fetch('/api/platform/plans', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

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
      setError('Não foi possível carregar os planos.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setPlans(data.plans ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  function startCreate() {
    setCreating(true)
    setEditingCode('')
    setForm(emptyForm)
    setError('')
    setSuccess('')
  }

  function startEdit(plan: Plan) {
    setCreating(false)
    setEditingCode(plan.code)
    setForm({
      code: plan.code,
      name: plan.name,
      description: plan.description ?? '',
      monthly_amount: formatCentsAsMoneyInput(plan.monthly_amount_cents),
      max_customer_groups: String(plan.max_customer_groups),
      sort_order: String(plan.sort_order),
      is_active: plan.is_active,
    })
    setError('')
    setSuccess('')
  }

  function closeForm() {
    setCreating(false)
    setEditingCode('')
    setForm(emptyForm)
  }

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token ?? ''
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    const response = await fetch(
      editingCode ? `/api/platform/plans/${editingCode}` : '/api/platform/plans',
      {
        method: editingCode ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      }
    )

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      const message = data?.message || data?.error || 'Não foi possível salvar o plano.'
      const details = data?.details ? ` Detalhe: ${data.details}` : ''

      setError(`${message}${details}`)
      return
    }

    setSuccess(editingCode ? 'Plano atualizado.' : 'Plano criado.')
    closeForm()
    await load()
  }

  async function togglePlan(plan: Plan) {
    setSaving(true)
    setError('')
    setSuccess('')

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    const response = await fetch(`/api/platform/plans/${plan.code}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: !plan.is_active }),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível alterar o status do plano.')
      return
    }

    setSuccess(plan.is_active ? 'Plano desativado.' : 'Plano ativado.')
    await load()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            onClick={() => router.push('/platform/tenants')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Planos</h1>
              <p className="text-sm text-gray-500 mt-1">
                Crie, edite e desative planos sem apagar historico.
              </p>
            </div>

            <button
              onClick={startCreate}
              className="h-10 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
            >
              Adicionar plano
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
            {success}
          </div>
        )}

        {(creating || editingCode) && (
          <form onSubmit={savePlan} className="bg-white rounded-2xl shadow p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-bold">
                {editingCode ? 'Editar plano' : 'Adicionar plano'}
              </h2>
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-gray-200 px-3 py-1 text-sm"
              >
                Fechar
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-medium">
                Codigo
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  disabled={Boolean(editingCode)}
                  placeholder="plan1"
                  required
                />
              </label>

              <label className="text-sm font-medium">
                Nome
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  required
                />
              </label>
            </div>

            <label className="block text-sm font-medium">
              Descricao
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-4">
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
                Limite grupos
                <input
                  value={form.max_customer_groups}
                  onChange={(event) => setForm({ ...form, max_customer_groups: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="number"
                  min="0"
                  required
                />
              </label>

              <label className="text-sm font-medium">
                Ordem
                <input
                  value={form.sort_order}
                  onChange={(event) => setForm({ ...form, sort_order: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  type="number"
                />
              </label>

              <label className="flex items-center gap-2 pt-6 text-sm font-medium">
                <input
                  checked={form.is_active}
                  onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                  type="checkbox"
                />
                Ativo
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar plano'}
            </button>
          </form>
        )}

        <section className="bg-white rounded-2xl shadow p-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Plano</th>
                  <th className="py-3 pr-4 font-medium">Mensalidade</th>
                  <th className="py-3 pr-4 font-medium">Grupos</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {plans.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      Nenhum plano cadastrado.
                    </td>
                  </tr>
                ) : (
                  plans.map((plan) => (
                    <tr key={plan.code} className="border-b border-gray-100">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{plan.name}</div>
                        <div className="text-xs text-gray-500">{plan.code}</div>
                        {plan.description && (
                          <div className="mt-1 text-xs text-gray-500">{plan.description}</div>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {formatCurrencyFromCents(plan.monthly_amount_cents)}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {plan.max_customer_groups}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {plan.is_active ? 'Ativo' : 'Inativo'}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => startEdit(plan)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => void togglePlan(plan)}
                            disabled={saving}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                          >
                            {plan.is_active ? 'Desativar' : 'Ativar'}
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
    </main>
  )
}
