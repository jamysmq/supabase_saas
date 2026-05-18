'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseAppointments } from '../../src/lib/plan-features'

type RevenueEvent = {
  id: string
  appointment_id: string
  customer_name_snapshot: string | null
  customer_document_snapshot: string | null
  customer_phone_snapshot: string | null
  service_name_snapshot: string | null
  staff_member_name_snapshot: string | null
  amount_cents: number
  currency: string
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

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valueCents / 100)
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

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    panel: 'Painel',
    whatsapp: 'WhatsApp',
    system: 'Sistema',
  }

  return labels[source] ?? source
}

export default function ServiceRevenuePage() {
  const router = useRouter()

  const [events, setEvents] = useState<RevenueEvent[]>([])
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

    if (!tenantCanUseAppointments(result.tenant?.plan) || result.tenant?.business_type !== 'salon') {
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

    const response = await fetch(`/api/service-revenue?${params.toString()}`, {
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
    setEvents(data.events ?? [])
    setLoading(false)
  }, [from, router, to])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const stats = useMemo(() => {
    const recognized = events.filter((event) => event.status === 'recognized')

    return {
      total: recognized.reduce((sum, event) => sum + event.amount_cents, 0),
      count: recognized.length,
      voided: events.filter((event) => event.status === 'voided').length,
    }
  }, [events])

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

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Financeiro de atendimentos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Atendimentos confirmados entram aqui com o valor do servico.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px] print:hidden">
              <label className="text-sm font-medium">
                Inicio
                <input
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                  type="date"
                />
              </label>

              <label className="text-sm font-medium">
                Fim
                <input
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                  type="date"
                />
              </label>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Total reconhecido</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrency(stats.total)}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Atendimentos</p>
            <p className="mt-1 text-2xl font-bold">{stats.count}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Estornados/cancelados</p>
            <p className="mt-1 text-2xl font-bold">{stats.voided}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">Nenhum atendimento financeiro no periodo.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {events.map((event) => (
                <article
                  key={event.id}
                  className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[190px_minmax(0,1fr)_160px]"
                >
                  <div>
                    <div className="text-sm font-bold">{formatDateTime(event.recognized_at)}</div>
                    <div className="text-xs text-gray-500">{sourceLabel(event.source)}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {event.customer_name_snapshot || 'Cliente sem nome'}
                    </div>
                    <div className="mt-1 break-words text-sm text-gray-500">
                      {event.service_name_snapshot || 'Serviço'} - {event.staff_member_name_snapshot || 'Sem profissional'}
                    </div>
                    <div className="mt-1 break-words text-xs text-gray-500">
                      {event.customer_phone_snapshot || 'Sem WhatsApp'}
                    </div>
                  </div>

                  <div className="lg:text-right">
                    <div className="text-sm font-bold">{formatCurrency(event.amount_cents)}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {event.status === 'recognized' ? 'Reconhecido' : 'Estornado'}
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
