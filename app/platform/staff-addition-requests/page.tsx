'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'
import { formatCurrencyFromCents } from '../../../src/lib/money'

type StaffRequest = {
  id: string
  name: string
  role: string | null
  status: string
  additional_amount_cents: number
  created_at: string
  tenant: {
    legal_name: string
    public_name: string | null
    plan: string
  } | null
  billingProfile: {
    base_amount_cents: number | null
    additional_staff_count: number
    additional_staff_amount_cents: number
    amount_cents: number
  } | null
}

type StaffRemoval = {
  id: string
  staff_member_name_snapshot: string
  staff_member_role_snapshot: string | null
  active_from: string
  removed_at: string
  active_days: number
  charge_next_billing: boolean
  amount_cents: number
  consumed_at: string | null
  tenant: StaffRequest['tenant']
}

function StaffRemovalHistory({ removals }: { removals: StaffRemoval[] }) {
  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="text-lg font-bold">Remoções recentes</h2>
      <p className="mt-1 text-sm text-gray-500">Histórico das exclusões e do efeito aplicado à próxima mensalidade.</p>
      {removals.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">Nenhuma remoção registrada.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {removals.map((item) => (
            <article key={item.id} className="grid gap-3 rounded-xl border border-gray-200 p-4 md:grid-cols-[1fr_280px] md:items-center">
              <div>
                <h3 className="font-bold">{item.staff_member_name_snapshot}</h3>
                {item.staff_member_role_snapshot && <p className="text-sm text-gray-600">{item.staff_member_role_snapshot}</p>}
                <p className="mt-1 text-sm text-gray-500">{item.tenant?.public_name || item.tenant?.legal_name || 'Negócio não encontrado'} · {item.active_days} dias ativo</p>
                <p className="mt-1 text-xs text-gray-400">Removido em {new Date(item.removed_at).toLocaleString('pt-BR')}</p>
              </div>
              <div className={`rounded-lg p-3 text-sm ${item.charge_next_billing ? 'bg-amber-50 text-amber-950' : 'bg-emerald-50 text-emerald-950'}`}>
                {item.charge_next_billing ? (
                  <>
                    <div className="font-bold">Último adicional: {formatCurrencyFromCents(item.amount_cents)}</div>
                    <div>{item.consumed_at ? 'Cobrança já aplicada.' : 'Pendente para a próxima mensalidade.'}</div>
                  </>
                ) : <div className="font-bold">Sem cobrança adicional na próxima mensalidade.</div>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default function StaffAdditionRequestsPage() {
  const router = useRouter()
  const [requests, setRequests] = useState<StaffRequest[]>([])
  const [removals, setRemovals] = useState<StaffRemoval[]>([])
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/platform/staff-addition-requests', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (response.status === 401) {
      router.push('/login')
      return
    }
    if (!response.ok) {
      setError('Não foi possível carregar as solicitações.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setRequests(data.requests ?? [])
    setRemovals(data.removals ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function review(item: StaffRequest, decision: 'approved' | 'rejected') {
    const action = decision === 'approved' ? 'aprovar' : 'recusar'
    if (!confirm(`Deseja ${action} a inclusão de ${item.name}?`)) return

    setActingId(item.id)
    setError('')
    setSuccess('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setActingId('')
      router.push('/login')
      return
    }

    const response = await fetch(`/api/platform/staff-addition-requests/${item.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ decision }),
    })
    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.error || 'Não foi possível analisar a solicitação.')
      return
    }

    setSuccess(
      decision === 'approved'
        ? `${item.name} foi liberado e a mensalidade recebeu o adicional de R$ 25,00.`
        : `A solicitação de ${item.name} foi recusada.`
    )
    await load()
  }

  if (loading) {
    return <main className="min-h-screen bg-gray-100 p-6 text-gray-950">Carregando...</main>
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow">
          <button
            type="button"
            onClick={() => router.push('/platform/tenants')}
            className="mb-3 text-sm text-gray-500"
          >
            Voltar
          </button>
          <h1 className="text-2xl font-bold">Profissionais adicionais</h1>
          <p className="mt-1 text-sm text-gray-500">
            Aprove ou recuse profissionais adicionais de salões. Cada aprovação acrescenta R$ 25,00 à mensalidade.
          </p>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{success}</div>}

        <section className="rounded-2xl bg-white p-5 shadow">
          {requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nenhuma solicitação pendente.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((item) => {
                const currentTotal = item.billingProfile?.amount_cents ?? 0
                return (
                  <article
                    key={item.id}
                    className="grid gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-[1fr_260px_auto] md:items-center"
                  >
                    <div>
                      <h2 className="font-bold">{item.name}</h2>
                      {item.role && <p className="text-sm text-gray-600">{item.role}</p>}
                      <p className="mt-1 text-sm text-gray-500">
                        {item.tenant?.public_name || item.tenant?.legal_name || 'Negócio não encontrado'} · {item.tenant?.plan}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        Solicitado em {new Date(item.created_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-950">
                      <div>Atual: {formatCurrencyFromCents(currentTotal)}</div>
                      <div className="font-bold">
                        Após aprovação: {formatCurrencyFromCents(currentTotal + item.additional_amount_cents)}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                      <button
                        type="button"
                        onClick={() => void review(item, 'approved')}
                        disabled={actingId === item.id}
                        className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => void review(item, 'rejected')}
                        disabled={actingId === item.id}
                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                      >
                        Recusar
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
        <StaffRemovalHistory removals={removals} />
      </div>
    </main>
  )
}
