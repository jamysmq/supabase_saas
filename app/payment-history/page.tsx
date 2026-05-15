'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'

type Customer = {
  full_name: string
  phone_e164: string | null
  email: string | null
  cpf: string | null
}

type BillingCycle = {
  id: string
  customer_id: string
  billing_profile_id: string | null
  reference_year: number
  reference_month: number
  due_date: string
  amount_cents: number
  currency: string
  status: string
  message_sent_at: string | null
  paid_at: string | null
  payment_note: string | null
  created_at: string
  updated_at: string
  tenant_customers: Customer | null
}

type BillingEvent = {
  id: string
  billing_profile_id: string | null
  customer_id: string | null
  event_type: string
  old_status: string | null
  new_status: string
  source: string
  note: string | null
  created_at: string
  tenant_customers: Customer | null
}

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendente' },
  { value: 'paid_manual', label: 'Pago manual' },
  { value: 'paid_asaas', label: 'Pago Asaas' },
  { value: 'canceled', label: 'Cancelado' },
  { value: 'overdue', label: 'Atrasado' },
]

function statusLabel(status: string) {
  const extra: Record<string, string> = {
    active: 'Ativa',
    paused: 'Pausada',
  }

  return statusOptions.find((option) => option.value === status)?.label ?? extra[status] ?? status
}

function formatMoney(amountCents: number) {
  return (amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('pt-BR')
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dateDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default function PaymentHistoryPage() {
  const router = useRouter()

  const [cycles, setCycles] = useState<BillingCycle[]>([])
  const [events, setEvents] = useState<BillingEvent[]>([])
  const [from, setFrom] = useState(dateDaysAgo(90))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const startsFrom = new Date(`${from}T00:00:00`).toISOString()
    const startsToDate = new Date(`${to}T00:00:00`)
    startsToDate.setDate(startsToDate.getDate() + 1)

    const params = new URLSearchParams({
      from: startsFrom,
      to: startsToDate.toISOString(),
    })

    if (status) {
      params.set('status', status)
    }

    const response = await fetch(`/api/payment-history?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Nao foi possivel carregar historico de pagamentos.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setCycles(data.cycles ?? [])
    setEvents(data.events ?? [])
    setLoading(false)
  }, [from, router, status, to])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredCycles = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return cycles

    return cycles.filter((cycle) => [
      cycle.tenant_customers?.full_name,
      cycle.tenant_customers?.email,
      cycle.tenant_customers?.cpf,
      cycle.tenant_customers?.phone_e164,
      cycle.status,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery)))
  }, [cycles, query])

  const stats = useMemo(() => {
    const paid = filteredCycles.filter((cycle) => cycle.status.startsWith('paid'))

    return {
      total: filteredCycles.length,
      paid: paid.length,
      amount: paid.reduce((sum, cycle) => sum + cycle.amount_cents, 0),
      events: events.length,
    }
  }, [events.length, filteredCycles])

  function exportPdf() {
    window.print()
  }

  function getBackHref() {
    const searchParams = new URLSearchParams(window.location.search)
    return searchParams.get('from') === 'dashboard'
      ? '/dashboard'
      : '/pending-payments'
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
            <button onClick={() => router.push(getBackHref())} className="text-sm text-gray-500">
              Voltar
            </button>
            <button onClick={exportPdf} className="h-9 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white">
              Exportar PDF
            </button>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Historico de pagamentos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Consulte pagamentos dos clientes e pausas/ativacoes de cobranca.
              </p>
              <p className="mt-2 hidden text-xs text-gray-500 print:block">
                Periodo: {from} ate {to} - Status: {statusLabel(status)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[520px] print:hidden">
              <label className="text-sm font-medium">
                Inicio
                <input value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal" type="date" />
              </label>
              <label className="text-sm font-medium">
                Fim
                <input value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal" type="date" />
              </label>
              <label className="text-sm font-medium">
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal">
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Registros</p>
            <p className="mt-1 text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Pagos</p>
            <p className="mt-1 text-2xl font-bold">{stats.paid}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Recebido</p>
            <p className="mt-1 text-2xl font-bold">{formatMoney(stats.amount)}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Eventos</p>
            <p className="mt-1 text-2xl font-bold">{stats.events}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="mb-4 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm print:hidden md:max-w-md" placeholder="Buscar por cliente, CPF, email ou telefone" />

          {filteredCycles.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nenhum pagamento encontrado no periodo.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredCycles.map((cycle) => (
                <article key={cycle.id} className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[minmax(0,1fr)_170px_150px]">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">{cycle.tenant_customers?.full_name ?? 'Cliente sem nome'}</div>
                    <div className="mt-1 break-words text-sm text-gray-500">{cycle.tenant_customers?.phone_e164 ?? '-'} - {cycle.tenant_customers?.email ?? '-'}</div>
                    <div className="mt-1 text-xs text-gray-500">Referencia {String(cycle.reference_month).padStart(2, '0')}/{cycle.reference_year} - Vencimento {formatDate(cycle.due_date)}</div>
                    {cycle.payment_note && <div className="mt-1 text-xs text-gray-500">{cycle.payment_note}</div>}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{formatMoney(cycle.amount_cents)}</div>
                    <div className="text-xs text-gray-500">Pago em {formatDateTime(cycle.paid_at)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="h-7 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{statusLabel(cycle.status)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <h2 className="mb-3 font-bold">Eventos de cobranca</h2>
          {events.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Nenhuma pausa ou ativacao de cobranca no periodo.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {events.map((event) => (
                <article key={event.id} className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div>
                    <div className="text-sm font-semibold">{event.tenant_customers?.full_name ?? 'Cliente sem nome'}</div>
                    <div className="mt-1 text-sm text-gray-500">{event.note || 'Status de cobranca alterado.'}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="h-7 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">{statusLabel(event.old_status || '')} para {statusLabel(event.new_status)}</span>
                    <span className="h-7 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">{formatDateTime(event.created_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
