'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'

type Signup = {
  id: string
  full_name: string
  customer_phone_e164: string
  group_name_snapshot: string | null
  amount_cents: number
  due_day: number
  created_at: string
}

const money = (value: number) => (value / 100).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export default function PendingSignupsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Signup[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState('')
  const [message, setMessage] = useState({ error: '', success: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setMessage((current) => ({ ...current, error: '' }))
    const current = await getCurrentTenantUser()

    if (!current) return router.push('/login')
    if (current.tenant?.business_type !== 'teacher' || !tenantCanUseBilling(current.tenant?.plan)) {
      return router.push('/dashboard')
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return router.push('/login')

    const response = await fetch('/api/pending-signups', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await response.json().catch(() => null)
    setLoading(false)
    if (!response.ok) {
      setMessage({ error: data?.message || 'Não foi possível carregar os cadastros.', success: '' })
      return
    }
    setItems(data.signups ?? [])
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function review(item: Signup, action: 'approve' | 'reject') {
    const verb = action === 'approve' ? 'aprovar e criar a mensalidade de' : 'recusar'
    if (!window.confirm(`Deseja ${verb} ${item.full_name}?`)) return

    setActing(item.id)
    setMessage({ error: '', success: '' })
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return router.push('/login')

    const response = await fetch(`/api/pending-signups/${item.id}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action }),
    })
    const data = await response.json().catch(() => null)
    setActing('')
    if (!response.ok) {
      setMessage({ error: data?.message || 'Não foi possível revisar o cadastro.', success: '' })
      return
    }
    setMessage({
      error: '',
      success: action === 'approve'
        ? `${item.full_name} foi cadastrado e a mensalidade inicial foi criada.`
        : `O cadastro de ${item.full_name} foi recusado.`,
    })
    await load()
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-sky-50">Carregando...</main>
  }

  const normalized = query.trim().toLocaleLowerCase('pt-BR')
  const filtered = items.filter((item) => {
    const searchable = `${item.full_name} ${item.customer_phone_e164} ${item.group_name_snapshot ?? ''}`
      .toLocaleLowerCase('pt-BR')
    return !normalized || searchable.includes(normalized)
  })

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#dff4ff_0%,#f4fbff_42%,#eef8ff_100%)] px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="rounded-lg border border-sky-100 bg-white p-5 shadow">
          <Link href="/dashboard" className="text-sm text-sky-700 hover:underline">Voltar ao painel</Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Alunos do professor</p>
              <h1 className="mt-1 text-2xl font-bold">Cadastros pendentes</h1>
              <p className="mt-1 text-sm text-slate-600">
                Revise os dados enviados pelo WhatsApp antes de ativar o aluno e a cobrança.
              </p>
            </div>
            <button onClick={() => void load()} className="h-10 rounded-lg border border-sky-200 px-4 text-sm font-medium hover:bg-sky-50">
              Atualizar
            </button>
          </div>
        </header>

        {message.error && <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{message.error}</div>}
        {message.success && <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">{message.success}</div>}

        <section className="space-y-4 rounded-lg border border-sky-100 bg-white p-5 shadow">
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por aluno, WhatsApp ou turma"
            className="w-full rounded-lg border border-sky-200 px-3 py-2 text-sm outline-none focus:border-sky-500" />

          {filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nenhum cadastro aguardando análise.</p>
          ) : filtered.map((item) => (
            <article key={item.id} className="grid gap-4 rounded-lg border border-slate-200 p-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
              <div>
                <h2 className="font-semibold">{item.full_name}</h2>
                <p className="mt-1 text-sm text-slate-600">WhatsApp: {item.customer_phone_e164}</p>
                <p className="text-sm text-slate-600">Turma: {item.group_name_snapshot || 'Não informada'}</p>
                <p className="mt-1 text-xs text-slate-500">Recebido em {new Date(item.created_at).toLocaleString('pt-BR')}</p>
              </div>
              <div className="rounded-lg bg-sky-50 p-3 text-sm">
                <p className="font-semibold text-sky-950">{money(item.amount_cents)} por mês</p>
                <p className="mt-1 text-slate-600">Vencimento: dia {item.due_day}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <button disabled={acting === item.id} onClick={() => void review(item, 'approve')}
                  className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50">
                  Aprovar
                </button>
                <button disabled={acting === item.id} onClick={() => void review(item, 'reject')}
                  className="h-10 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                  Recusar
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}
