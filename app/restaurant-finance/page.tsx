'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseRestaurant } from '../../src/lib/plan-features'
import { formatCurrencyFromCents } from '../../src/lib/money'

type RestaurantOrder = {
  id: string
  customer_name: string | null
  customer_phone_e164: string | null
  delivery_address: string | null
  total_cents: number
  payment_method: string
  status: string
  confirmed_at: string
  paid_at: string | null
  cancelled_at: string | null
}

type RevenueEvent = {
  id: string
  order_id: string
  total_cents: number
  payment_method: string
  status: string
  recognized_at: string
  voided_at: string | null
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

export default function RestaurantFinancePage() {
  const router = useRouter()

  const [orders, setOrders] = useState<RestaurantOrder[]>([])
  const [revenueEvents, setRevenueEvents] = useState<RevenueEvent[]>([])
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

    if (!tenantCanUseRestaurant(result.tenant?.plan)) {
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

    const response = await fetch('/api/restaurant/orders', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar o financeiro.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setOrders(data.orders ?? [])
    setRevenueEvents(data.revenueEvents ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const orderById = useMemo(() => {
    return new Map(orders.map((order) => [order.id, order]))
  }, [orders])

  const recognizedEvents = useMemo(() => {
    return revenueEvents.filter((event) => event.status === 'recognized')
  }, [revenueEvents])

  const cancelledOrders = useMemo(() => {
    return orders.filter((order) => order.status === 'cancelled')
  }, [orders])

  const stats = useMemo(() => {
    return {
      total: recognizedEvents.reduce((sum, event) => sum + event.total_cents, 0),
      paid: recognizedEvents.length,
      cancelled: cancelledOrders.length,
    }
  }, [cancelledOrders.length, recognizedEvents])

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
              onClick={() => window.print()}
              className="h-9 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
            >
              Exportar PDF
            </button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Financeiro de pedidos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Histórico de pedidos baixados no financeiro e pedidos cancelados.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:w-[520px] print:grid-cols-3">
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold">
                {formatCurrencyFromCents(stats.total)}
              </div>
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                <span className="font-bold">{stats.paid}</span> pagos
              </div>
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                <span className="font-bold">{stats.cancelled}</span> cancelados
              </div>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <h2 className="mb-3 font-bold">Pedidos pagos</h2>
          {recognizedEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Nenhuma baixa financeira encontrada.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {recognizedEvents.map((event) => {
                const order = orderById.get(event.order_id)

                return (
                  <article key={event.id} className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[190px_minmax(0,1fr)_160px]">
                    <div>
                      <div className="text-sm font-bold">{formatDateTime(event.recognized_at)}</div>
                      <div className="text-xs text-gray-500">{paymentLabel(event.payment_method)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="break-words text-sm font-semibold">
                        {order?.customer_name || 'Cliente sem nome'}
                      </div>
                      <div className="mt-1 break-words text-sm text-gray-500">
                        {order?.customer_phone_e164 || 'Sem WhatsApp'}
                        {order?.delivery_address ? ` - ${order.delivery_address}` : ''}
                      </div>
                    </div>
                    <div className="text-sm font-bold lg:text-right">
                      {formatCurrencyFromCents(event.total_cents)}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <h2 className="mb-3 font-bold">Pedidos cancelados</h2>
          {cancelledOrders.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">Nenhum pedido cancelado.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {cancelledOrders.map((order) => (
                <article key={order.id} className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[190px_minmax(0,1fr)_160px]">
                  <div>
                    <div className="text-sm font-bold">
                      {formatDateTime(order.cancelled_at || order.confirmed_at)}
                    </div>
                    <div className="text-xs text-gray-500">{paymentLabel(order.payment_method)}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {order.customer_name || 'Cliente sem nome'}
                    </div>
                    <div className="mt-1 break-words text-sm text-gray-500">
                      {order.customer_phone_e164 || 'Sem WhatsApp'}
                      {order.delivery_address ? ` - ${order.delivery_address}` : ''}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-red-700 lg:text-right">
                    {formatCurrencyFromCents(order.total_cents)}
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
