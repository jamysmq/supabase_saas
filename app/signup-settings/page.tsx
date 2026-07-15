'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCentsAsMoneyInput, formatCurrencyFromCents, formatMoneyInput, parseMoneyToCents } from '../../src/lib/money'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'

type SignupSettings = {
  whatsapp_customer_signup_enabled: boolean
  whatsapp_signup_billing_mode: 'fixed' | 'plans'
  whatsapp_signup_fixed_amount_cents: number | null
  whatsapp_signup_fixed_due_day: number | null
}

type SignupPlan = {
  id: string
  name: string
  description: string | null
  amount_cents: number
  due_day: number
}

type PlanForm = {
  name: string
  description: string
  amount: string
  due_day: string
}

const emptyPlan: PlanForm = { name: '', description: '', amount: '', due_day: '10' }

export function SignupSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter()
  const [settings, setSettings] = useState<SignupSettings | null>(null)
  const [plans, setPlans] = useState<SignupPlan[]>([])
  const [fixedAmount, setFixedAmount] = useState('')
  const [fixedDueDay, setFixedDueDay] = useState('10')
  const [planForm, setPlanForm] = useState<PlanForm>(emptyPlan)
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const authorizedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Sua sessão expirou. Entre novamente.')
    return fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const current = await getCurrentTenantUser()
    if (!current) {
      router.push('/login')
      return
    }
    if (current.tenant?.business_type !== 'teacher' || !['plan1', 'plan3'].includes(current.tenant?.plan ?? '')) {
      router.push('/dashboard')
      return
    }

    try {
      const [settingsResponse, plansResponse] = await Promise.all([
        authorizedFetch('/api/whatsapp-signup-settings'),
        authorizedFetch('/api/whatsapp-signup-plans'),
      ])
      const settingsPayload = await settingsResponse.json()
      const plansPayload = await plansResponse.json()
      if (!settingsResponse.ok) throw new Error(settingsPayload.message)
      if (!plansResponse.ok) throw new Error(plansPayload.message)
      setSettings(settingsPayload.settings)
      setPlans(plansPayload.plans)
      setFixedAmount(formatCentsAsMoneyInput(settingsPayload.settings.whatsapp_signup_fixed_amount_cents))
      setFixedDueDay(String(settingsPayload.settings.whatsapp_signup_fixed_due_day ?? 10))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as configurações.')
    } finally {
      setLoading(false)
    }
  }, [authorizedFetch, router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function updateSettings(patch: Record<string, unknown>, message: string) {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const response = await authorizedFetch('/api/whatsapp-signup-settings', {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message)
      setSettings(payload.settings)
      setSuccess(message)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a configuração.')
    } finally {
      setSaving(false)
    }
  }

  async function saveFixed(event: React.FormEvent) {
    event.preventDefault()
    const amount = parseMoneyToCents(fixedAmount)
    const dueDay = Number(fixedDueDay)
    if (!Number.isInteger(amount) || amount <= 0) return setError('Informe um valor mensal válido.')
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return setError('Informe um vencimento entre 1 e 31.')
    await updateSettings({ billing_mode: 'fixed', fixed_amount_cents: amount, fixed_due_day: dueDay }, 'Mensalidade fixa salva.')
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault()
    const amountCents = parseMoneyToCents(planForm.amount)
    const dueDay = Number(planForm.due_day)
    if (!planForm.name.trim()) return setError('Informe o nome do plano.')
    if (!Number.isInteger(amountCents) || amountCents <= 0) return setError('Informe um valor mensal válido.')
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return setError('Informe um vencimento entre 1 e 31.')

    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const path = editingPlanId ? `/api/whatsapp-signup-plans/${editingPlanId}` : '/api/whatsapp-signup-plans'
      const response = await authorizedFetch(path, {
        method: editingPlanId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: planForm.name,
          description: planForm.description,
          amount_cents: amountCents,
          due_day: dueDay,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message)
      setPlanForm(emptyPlan)
      setEditingPlanId(null)
      setSuccess(editingPlanId ? 'Plano atualizado.' : 'Plano criado.')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar o plano.')
    } finally {
      setSaving(false)
    }
  }

  function editPlan(plan: SignupPlan) {
    setEditingPlanId(plan.id)
    setPlanForm({
      name: plan.name,
      description: plan.description ?? '',
      amount: formatCentsAsMoneyInput(plan.amount_cents),
      due_day: String(plan.due_day),
    })
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }

  async function removePlan(plan: SignupPlan) {
    if (!window.confirm(`Desativar o plano “${plan.name}”?`)) return
    setSaving(true)
    try {
      const response = await authorizedFetch(`/api/whatsapp-signup-plans/${plan.id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message)
      setPlans((current) => current.filter((item) => item.id !== plan.id))
      setSuccess('Plano desativado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível desativar o plano.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className={embedded ? 'py-10 text-center' : 'min-h-screen bg-sky-50 p-6 text-center'}>Carregando...</div>

  return (
    <div className={embedded ? 'text-slate-950' : 'min-h-screen bg-sky-50 px-4 py-6 text-slate-950'}>
      <div className={embedded ? 'space-y-4' : 'mx-auto max-w-4xl space-y-4'}>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          {!embedded && <button onClick={() => router.push('/students')} className="mb-3 text-sm text-sky-700">← Voltar ao gerenciamento dos alunos</button>}
          <h1 className={embedded ? 'text-lg font-bold' : 'text-2xl font-bold'}>Planos e cadastro pelo WhatsApp</h1>
          <p className="mt-1 text-sm text-slate-600">
            Defina o valor que o Jack apresentará. O aluno escolhe apenas entre opções prontas; valores e vencimentos são controlados por você.
          </p>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-bold">Receber novos cadastros</h2>
              <p className="text-sm text-slate-600">Quando desativado, o Jack informa que os cadastros estão temporariamente fechados.</p>
            </div>
            <button
              type="button"
              disabled={saving || !settings}
              onClick={() => void updateSettings({ enabled: !settings?.whatsapp_customer_signup_enabled }, settings?.whatsapp_customer_signup_enabled ? 'Cadastros pausados.' : 'Cadastros ativados.')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${settings?.whatsapp_customer_signup_enabled ? 'bg-emerald-700' : 'bg-slate-600'}`}
            >
              {settings?.whatsapp_customer_signup_enabled ? 'Ativo · pausar' : 'Pausado · ativar'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold">Como cobrar a mensalidade</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void updateSettings({ billing_mode: 'fixed' }, 'Mensalidade fixa selecionada.')}
              className={`rounded-xl border p-4 text-left ${settings?.whatsapp_signup_billing_mode === 'fixed' ? 'border-sky-600 bg-sky-50' : 'border-slate-200'}`}
            >
              <strong>Um valor fixo</strong>
              <span className="mt-1 block text-sm text-slate-600">Todos os novos alunos recebem o mesmo valor e vencimento.</span>
            </button>
            <button
              type="button"
              onClick={() => void updateSettings({ billing_mode: 'plans' }, 'Planos de mensalidade selecionados.')}
              className={`rounded-xl border p-4 text-left ${settings?.whatsapp_signup_billing_mode === 'plans' ? 'border-sky-600 bg-sky-50' : 'border-slate-200'}`}
            >
              <strong>Planos de mensalidade</strong>
              <span className="mt-1 block text-sm text-slate-600">O aluno escolhe um plano em botões ou lista, conforme a quantidade.</span>
            </button>
          </div>
        </section>

        {settings?.whatsapp_signup_billing_mode === 'fixed' ? (
          <form onSubmit={saveFixed} className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-bold">Mensalidade fixa</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Valor mensal
                <input value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} onBlur={() => setFixedAmount(formatMoneyInput(fixedAmount))} placeholder="R$ 120,00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" required />
              </label>
              <label className="text-sm font-medium">Dia do vencimento
                <input type="number" min="1" max="31" value={fixedDueDay} onChange={(e) => setFixedDueDay(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" required />
              </label>
            </div>
            <button disabled={saving} className="mt-4 rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Salvar mensalidade fixa</button>
          </form>
        ) : (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-bold">Planos disponíveis</h2>
              {plans.length === 0 ? <p className="mt-3 text-sm text-amber-700">Crie ao menos um plano para liberar o cadastro.</p> : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {plans.map((plan) => (
                    <article key={plan.id} className="rounded-xl border border-slate-200 p-4">
                      <h3 className="font-semibold">{plan.name}</h3>
                      {plan.description && <p className="mt-1 text-sm text-slate-600">{plan.description}</p>}
                      <p className="mt-3 text-sm"><strong>{formatCurrencyFromCents(plan.amount_cents)}</strong> · vence dia {plan.due_day}</p>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => editPlan(plan)} className="rounded-lg border border-sky-200 px-3 py-1.5 text-sm text-sky-700">Editar</button>
                        <button type="button" onClick={() => void removePlan(plan)} className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700">Desativar</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <form onSubmit={savePlan} className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-bold">{editingPlanId ? 'Editar plano' : 'Criar plano'}</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">Nome do plano
                  <input value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" maxLength={80} required />
                </label>
                <label className="text-sm font-medium">Valor mensal
                  <input value={planForm.amount} onChange={(e) => setPlanForm({ ...planForm, amount: e.target.value })} onBlur={() => setPlanForm({ ...planForm, amount: formatMoneyInput(planForm.amount) })} placeholder="R$ 120,00" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" required />
                </label>
                <label className="text-sm font-medium">Dia do vencimento
                  <input type="number" min="1" max="31" value={planForm.due_day} onChange={(e) => setPlanForm({ ...planForm, due_day: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" required />
                </label>
                <label className="text-sm font-medium">Descrição curta (opcional)
                  <input value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" maxLength={240} />
                </label>
              </div>
              <div className="mt-4 flex gap-2">
                <button disabled={saving} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{editingPlanId ? 'Salvar alterações' : 'Criar plano'}</button>
                {editingPlanId && <button type="button" onClick={() => { setEditingPlanId(null); setPlanForm(emptyPlan) }} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">Cancelar</button>}
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

export default function SignupSettingsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/students') }, [router])
  return <main className="min-h-screen bg-sky-50 p-6 text-center">Abrindo o gerenciamento dos alunos...</main>
}
