'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getAllowedPlanCodesForBusinessType } from '../../src/lib/plan-features'

type Plan = {
  code: string
  name: string
  monthly_amount_cents: number
}

type SignupForm = {
  legal_name: string
  public_name: string
  cpf: string
  email: string
  admin_email: string
  birth_date: string
  whatsapp_e164: string
  business_type: string
  plan: string
  due_day: string
}

const emptyForm: SignupForm = {
  legal_name: '',
  public_name: '',
  cpf: '',
  email: '',
  admin_email: '',
  birth_date: '',
  whatsapp_e164: '',
  business_type: 'teacher',
  plan: 'plan1',
  due_day: '',
}

export default function SignupPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [form, setForm] = useState<SignupForm>(emptyForm)
  const [modalOpen, setModalOpen] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    async function loadPlans() {
      const response = await fetch('/api/public/plans')
      const data = response.ok ? await response.json() : { plans: [] }
      const activePlans = data.plans ?? []

      setPlans(activePlans)

      if (activePlans.length > 0) {
        setForm((current) => {
          const allowedCodes = getAllowedPlanCodesForBusinessType(current.business_type)
          const compatiblePlans = activePlans.filter((plan: Plan) => allowedCodes.includes(plan.code))
          const currentPlan = compatiblePlans.find((plan: Plan) => plan.code === current.plan)
          const selectedPlan = currentPlan ?? compatiblePlans[0] ?? activePlans[0]

          return {
            ...current,
            plan: selectedPlan.code,
          }
        })
      }

      setLoadingPlans(false)
    }

    void loadPlans()
  }, [])

  const availablePlans = useMemo(() => {
    const allowedCodes = getAllowedPlanCodesForBusinessType(form.business_type)
    return plans.filter((plan) => allowedCodes.includes(plan.code))
  }, [form.business_type, plans])

  function selectBusinessType(businessType: string) {
    const allowedCodes = getAllowedPlanCodesForBusinessType(businessType)
    const nextPlan = allowedCodes.includes(form.plan) ? form.plan : allowedCodes[0]

    setForm({
      ...form,
      business_type: businessType,
      plan: nextPlan,
    })
  }

  function selectPlan(planCode: string) {
    setForm({
      ...form,
      plan: planCode,
    })
  }

  function getPlanLabel(plan: Plan) {
    if (plan.code === 'plan3') {
      return 'Plano 3 - Completo (Cobranças + Agenda)'
    }

    return plan.name
  }

  async function submitSignup(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const response = await fetch('/api/public/signup-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || data?.error || 'Nao foi possivel concluir a solicitacao.')
      return
    }

    setSuccess('Cadastro enviado! Vamos confirmar seus dados e retornar pelo contato informado.')
    setForm(emptyForm)
    setModalOpen(false)
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#dff4ff_0%,#f7fbff_52%,#eef8ff_100%)] text-slate-950">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-4">
          <Link className="text-sm font-bold uppercase tracking-[0.14em] text-sky-900" href="/">
            Assistente Jack
          </Link>
          <Link
            className="rounded-md border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 shadow-sm hover:bg-sky-50"
            href="https://app.meuassistentevirtual.com.br/login"
          >
            Entrar
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-8 py-12 lg:grid-cols-[1.05fr_0.95fr]">
          <section>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-sky-700">
              Comece pelo WhatsApp
            </p>
            <h1 className="mt-4 max-w-2xl text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
              Se cadastre para usar o Assistente Jack no seu negócio.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600">
              Envie os dados do seu negócio em poucos minutos. Confirmamos seu
              cadastro e liberamos o acesso para você começar a usar.
            </p>

            {success && (
              <div className="mt-6 rounded-lg bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                {success}
              </div>
            )}

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <button
                className="rounded-md bg-sky-700 px-5 py-3 text-center text-sm font-bold text-white shadow-sm hover:bg-sky-800 disabled:opacity-50"
                disabled={loadingPlans}
                onClick={() => {
                  setError('')
                  setSuccess('')
                  setModalOpen(true)
                }}
                type="button"
              >
                Solicitar cadastro
              </button>
              <Link
                className="rounded-md border border-sky-200 bg-white px-5 py-3 text-center text-sm font-bold text-sky-800 hover:bg-sky-50"
                href="/"
              >
                Página inicial
              </Link>
            </div>
          </section>

          <section className="space-y-3">
            {[
              ['Cobranças e alunos', 'Para professores, escolas pequenas e serviços com mensalidade recorrente.'],
              ['Agenda', 'Para salões, clínicas e profissionais que precisam organizar horários.'],
              ['Catálogo e pedidos', 'Para restaurantes, lojas de material, petshops e quem vende por catálogo no WhatsApp.'],
            ].map(([title, description]) => (
              <article className="rounded-lg border border-sky-100 bg-white p-5 shadow" key={title}>
                <h2 className="font-bold text-slate-950">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </article>
            ))}
          </section>
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 md:items-center md:justify-center">
          <form
            onSubmit={submitSignup}
            className="max-h-[92vh] w-full overflow-y-auto rounded-lg bg-white p-5 shadow-xl md:max-w-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold">Solicitar cadastro</h2>
                <p className="text-sm text-slate-500">
                  Preencha os dados do seu negócio. Leva poucos minutos.
                </p>
              </div>
              <button
                className="rounded-lg border border-sky-200 px-3 py-1 text-sm font-medium text-sky-800"
                onClick={() => setModalOpen(false)}
                type="button"
              >
                Fechar
              </button>
            </div>

            <div className="grid gap-3">
              {error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <label className="text-sm font-medium">
                Nome completo ou razão social
                <input
                  value={form.legal_name}
                  onChange={(event) => setForm({ ...form, legal_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                  required
                />
              </label>

              <label className="text-sm font-medium">
                Nome fantasia
                <input
                  value={form.public_name}
                  onChange={(event) => setForm({ ...form, public_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                  placeholder="Nome que seus clientes verão no WhatsApp"
                  required
                />
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  CPF/CNPJ
                  <input
                    value={form.cpf}
                    onChange={(event) => setForm({ ...form, cpf: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Data de nascimento ou abertura
                  <input
                    value={form.birth_date}
                    onChange={(event) => setForm({ ...form, birth_date: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
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
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    type="email"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  E-mail de acesso
                  <input
                    value={form.admin_email}
                    onChange={(event) => setForm({ ...form, admin_email: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    placeholder="Se vazio, usamos o e-mail do negócio"
                    type="email"
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium">
                  WhatsApp
                  <input
                    value={form.whatsapp_e164}
                    onChange={(event) => setForm({ ...form, whatsapp_e164: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    placeholder="5583999999999"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Tipo de negócio
                  <select
                    value={form.business_type}
                    onChange={(event) => selectBusinessType(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
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
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    required
                  >
                    {availablePlans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {getPlanLabel(plan)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Dia de cobrança da mensalidade
                  <input
                    value={form.due_day}
                    onChange={(event) => setForm({ ...form, due_day: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2 font-normal"
                    max="31"
                    min="1"
                    type="number"
                    required
                  />
                </label>
              </div>
            </div>

            <button
              className="mt-5 w-full rounded-lg bg-sky-700 py-2 font-bold text-white hover:bg-sky-800 disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Enviando...' : 'Concluir solicitação'}
            </button>
          </form>
        </div>
      )}
    </main>
  )
}
