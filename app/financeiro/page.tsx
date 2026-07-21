'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseCatalog, tenantCanUseOperationalFinance } from '../../src/lib/plan-features'
import { formatCurrencyFromCents } from '../../src/lib/money'
import { openNativePicker } from '../../src/lib/open-native-picker'

// Entrada financeira normalizada, vinda de pedidos (catálogo) ou atendimentos/estoque (agenda).
type FinanceEntry = {
  id: string
  date: string
  title: string
  subtitle: string
  origin: string
  amountCents: number
  status: 'recognized' | 'voided' | 'cancelled'
}

type CatalogOrder = {
  id: string
  customer_name: string | null
  customer_phone_e164: string | null
  total_cents: number
  payment_method: string
  status: string
  confirmed_at: string
  cancelled_at: string | null
}

type CatalogRevenueEvent = {
  id: string
  order_id: string
  total_cents: number
  payment_method: string
  status: string
  recognized_at: string
  voided_at: string | null
}

type ServiceRevenueEvent = {
  id: string
  customer_name_snapshot: string | null
  customer_phone_snapshot: string | null
  service_name_snapshot: string | null
  staff_member_name_snapshot: string | null
  amount_cents: number
  status: string
  source: string
  recognized_at: string
  voided_at: string | null
}

function dateDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function paymentLabel(value: string) {
  const labels: Record<string, string> = {
    cash_on_delivery: 'Dinheiro na entrega',
    pix_on_delivery: 'Pix na entrega',
    card_on_delivery: 'Cartão na entrega',
    online_pix: 'Pix online',
    online_card: 'Cartão online',
  }

  return labels[value] ?? value
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    panel: 'Painel',
    whatsapp: 'WhatsApp',
    system: 'Sistema',
    stock_purchase: 'Estoque',
  }

  return labels[source] ?? source
}

export default function FinancePage() {
  const router = useRouter()

  const [orders, setOrders] = useState<CatalogOrder[]>([])
  const [catalogRevenue, setCatalogRevenue] = useState<CatalogRevenueEvent[]>([])
  const [serviceEvents, setServiceEvents] = useState<ServiceRevenueEvent[]>([])
  const [from, setFrom] = useState(dateDaysAgo(30))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
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

    const plan = result.tenant?.plan
    const canUseCatalog = tenantCanUseCatalog(plan)
    const canUseOperationalFinance = tenantCanUseOperationalFinance(plan)

    if (!canUseCatalog && !canUseOperationalFinance) {
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

    const headers = { Authorization: `Bearer ${session.access_token}` }

    if (canUseCatalog) {
      const response = await fetch('/api/catalog/orders', { headers })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.message || 'Não foi possível carregar o financeiro de pedidos.')
        setLoading(false)
        return
      }

      const data = await response.json()
      setOrders(data.orders ?? [])
      setCatalogRevenue(data.revenueEvents ?? [])
    }

    if (canUseOperationalFinance) {
      const response = await fetch('/api/service-revenue', { headers })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.message || 'Não foi possível carregar o financeiro operacional.')
        setLoading(false)
        return
      }

      const data = await response.json()
      setServiceEvents(data.events ?? [])
    }

    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  // Junta pedidos e atendimentos numa única lista normalizada.
  const allEntries = useMemo<FinanceEntry[]>(() => {
    const orderById = new Map(orders.map((order) => [order.id, order]))
    const entries: FinanceEntry[] = []

    for (const event of catalogRevenue) {
      if (event.status !== 'recognized') continue
      const order = orderById.get(event.order_id)
      entries.push({
        id: `cat-${event.id}`,
        date: event.recognized_at,
        title: order?.customer_name || 'Cliente sem nome',
        subtitle: paymentLabel(event.payment_method),
        origin: 'Pedido',
        amountCents: event.total_cents,
        status: 'recognized',
      })
    }

    for (const order of orders) {
      if (order.status !== 'cancelled') continue
      entries.push({
        id: `cat-cancel-${order.id}`,
        date: order.cancelled_at || order.confirmed_at,
        title: order.customer_name || 'Cliente sem nome',
        subtitle: paymentLabel(order.payment_method),
        origin: 'Pedido cancelado',
        amountCents: order.total_cents,
        status: 'cancelled',
      })
    }

    for (const event of serviceEvents) {
      const isStock = event.source === 'stock_purchase'
      entries.push({
        id: `svc-${event.id}`,
        date: event.recognized_at,
        title: isStock ? 'Despesa de estoque' : event.customer_name_snapshot || 'Cliente sem nome',
        subtitle: isStock
          ? sourceLabel(event.source)
          : `${event.service_name_snapshot || 'Serviço'} - ${event.staff_member_name_snapshot || 'Sem profissional'}`,
        origin: sourceLabel(event.source),
        amountCents: event.amount_cents,
        status: event.status === 'recognized' ? 'recognized' : 'voided',
      })
    }

    return entries
  }, [orders, catalogRevenue, serviceEvents])

  const filteredEntries = useMemo(() => {
    const fromTs = new Date(`${from}T00:00:00`).getTime()
    const toDate = new Date(`${to}T00:00:00`)
    toDate.setDate(toDate.getDate() + 1)
    const toTs = toDate.getTime()

    return allEntries
      .filter((entry) => {
        const ts = new Date(entry.date).getTime()
        return ts >= fromTs && ts < toTs
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [allEntries, from, to])

  const stats = useMemo(() => {
    const recognized = filteredEntries.filter((entry) => entry.status === 'recognized')
    const income = recognized.filter((entry) => entry.amountCents > 0)
    const expenses = recognized.filter((entry) => entry.amountCents < 0)

    return {
      income: income.reduce((sum, entry) => sum + entry.amountCents, 0),
      expenses: expenses.reduce((sum, entry) => sum + Math.abs(entry.amountCents), 0),
      net: recognized.reduce((sum, entry) => sum + entry.amountCents, 0),
      count: income.length,
      cancelled: filteredEntries.filter((entry) => entry.status === 'cancelled').length,
    }
  }, [filteredEntries])

  const dailySummary = useMemo(() => {
    const byDay = new Map<string, { income: number; expenses: number; net: number }>()

    for (const entry of filteredEntries) {
      if (entry.status !== 'recognized') continue
      const day = entry.date.slice(0, 10)
      const current = byDay.get(day) ?? { income: 0, expenses: 0, net: 0 }
      if (entry.amountCents >= 0) {
        current.income += entry.amountCents
      } else {
        current.expenses += Math.abs(entry.amountCents)
      }
      current.net += entry.amountCents
      byDay.set(day, current)
    }

    return Array.from(byDay.entries())
      .map(([day, totals]) => ({ day, ...totals }))
      .sort((a, b) => (a.day < b.day ? 1 : -1))
  }, [filteredEntries])

  function exportCsv() {
    const header = ['Data', 'Origem', 'Descrição', 'Detalhe', 'Status', 'Valor']
    const statusText: Record<FinanceEntry['status'], string> = {
      recognized: 'Reconhecido',
      voided: 'Estornado',
      cancelled: 'Cancelado',
    }

    const rows = filteredEntries.map((entry) => [
      formatDateTime(entry.date),
      entry.origin,
      entry.title,
      entry.subtitle,
      statusText[entry.status],
      (entry.amountCents / 100).toFixed(2).replace('.', ','),
    ])

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escape(String(cell))).join(';'))
      .join('\r\n')

    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `financeiro_${from}_a_${to}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
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
            <button onClick={() => router.push('/dashboard')} className="text-sm text-gray-500">
              Voltar
            </button>
            <button
              onClick={exportCsv}
              className="h-9 rounded-lg border border-gray-200 px-4 text-sm font-medium"
            >
              Exportar CSV
            </button>
            <button
              onClick={() => window.print()}
              className="h-9 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
            >
              Exportar PDF
            </button>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Financeiro</h1>
              <p className="mt-1 text-sm text-gray-500">
                Receitas, despesas e saldo do período. Pedidos pagos, atendimentos e estoque num só lugar.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px] print:hidden">
              <label className="text-sm font-medium">
                Início
                <input
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  onClick={openNativePicker}
                  className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-gray-200 px-3 font-normal"
                  type="date"
                />
              </label>

              <label className="text-sm font-medium">
                Fim
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  onClick={openNativePicker}
                  className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-gray-200 px-3 font-normal"
                  type="date"
                />
              </label>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Receita reconhecida</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrencyFromCents(stats.income)}</p>
            <p className="mt-1 text-xs text-gray-500">{stats.count} lançamentos</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Despesas</p>
            <p className="mt-1 text-2xl font-bold text-red-700">-{formatCurrencyFromCents(stats.expenses)}</p>
            <p className="mt-1 text-xs text-gray-500">{stats.cancelled} pedidos cancelados</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Saldo do período</p>
            <p className={`mt-1 text-2xl font-bold ${stats.net < 0 ? 'text-red-700' : ''}`}>
              {formatCurrencyFromCents(stats.net)}
            </p>
          </div>
        </section>

        {dailySummary.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
            <h2 className="mb-3 font-bold">Resumo por dia</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3 font-medium">Dia</th>
                    <th className="py-2 pr-3 font-medium">Receita</th>
                    <th className="py-2 pr-3 font-medium">Despesa</th>
                    <th className="py-2 font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dailySummary.map((day) => (
                    <tr key={day.day}>
                      <td className="py-2 pr-3 font-medium">{formatDay(day.day)}</td>
                      <td className="py-2 pr-3">{formatCurrencyFromCents(day.income)}</td>
                      <td className="py-2 pr-3 text-red-700">
                        {day.expenses > 0 ? `-${formatCurrencyFromCents(day.expenses)}` : formatCurrencyFromCents(0)}
                      </td>
                      <td className={`py-2 font-bold ${day.net < 0 ? 'text-red-700' : ''}`}>
                        {formatCurrencyFromCents(day.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <h2 className="mb-3 font-bold">Lançamentos</h2>
          {filteredEntries.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nenhum lançamento financeiro no período.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredEntries.map((entry) => (
                <article
                  key={entry.id}
                  className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[190px_minmax(0,1fr)_160px]"
                >
                  <div>
                    <div className="text-sm font-bold">{formatDateTime(entry.date)}</div>
                    <div className="text-xs text-gray-500">{entry.origin}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">{entry.title}</div>
                    <div className="mt-1 break-words text-sm text-gray-500">{entry.subtitle}</div>
                  </div>

                  <div className="lg:text-right">
                    <div
                      className={`text-sm font-bold ${
                        entry.status === 'cancelled' || entry.amountCents < 0 ? 'text-red-700' : ''
                      }`}
                    >
                      {formatCurrencyFromCents(entry.amountCents)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {entry.status === 'recognized'
                        ? 'Reconhecido'
                        : entry.status === 'cancelled'
                          ? 'Cancelado'
                          : 'Estornado'}
                    </div>
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
