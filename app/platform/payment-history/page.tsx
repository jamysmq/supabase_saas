'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'
import { openNativePicker } from '../../../src/lib/open-native-picker'

type PaymentTenant = {
  legal_name: string
  email: string
  cpf: string
  whatsapp_e164: string
  business_type: string | null
  plan: string
}

type PaymentEvent = {
  old_status: string | null
  new_status: string
  source: string
  event_type: string
  note: string | null
  created_at: string
}

type PlatformPaymentHistory = {
  id: string
  tenant_id: string
  provider: string
  asaas_payment_id: string | null
  amount_cents: number
  billing_type: string | null
  status: string
  payload: Record<string, unknown> | null
  created_at: string
  confirmed_at: string | null
  confirmed_source: string | null
  confirmed_note: string | null
  deleted_at: string | null
  tenants: PaymentTenant | null
  latest_event: PaymentEvent | null
}

type BillingEvent = {
  id: string
  billing_profile_id: string | null
  tenant_id: string | null
  old_status: string | null
  new_status: string
  source: string
  event_type: string
  note: string | null
  created_at: string
  tenant_legal_name_snapshot: string | null
  tenant_email_snapshot: string | null
  tenant_cpf_snapshot: string | null
  tenant_whatsapp_snapshot: string | null
  tenant_business_type_snapshot: string | null
  tenant_plan_snapshot: string | null
  tenants: PaymentTenant | null
}

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'pending', label: 'Pendente' },
  { value: 'paid', label: 'Pago' },
  { value: 'deleted', label: 'Excluido' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'failed', label: 'Falhou' },
]

function formatMoney(amountCents: number) {
  return (amountCents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
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

function statusLabel(status: string) {
  const billingStatusLabels: Record<string, string> = {
    active: 'Ativa',
    paused: 'Pausada',
  }

  return statusOptions.find((option) => option.value === status)?.label ?? billingStatusLabels[status] ?? status
}

function sourceLabel(source: string | null | undefined) {
  const labels: Record<string, string> = {
    manual: 'Confirmacao manual',
    manual_delete: 'Exclusao manual',
    asaas_qrcode: 'Asaas QR Code',
    asaas_webhook: 'Asaas webhook',
  }

  return labels[source || ''] ?? source ?? 'Origem não informada'
}

function eventTenantName(event: BillingEvent) {
  return event.tenants?.legal_name ?? event.tenant_legal_name_snapshot ?? 'Negócio sem nome'
}

function eventTenantContact(event: BillingEvent) {
  return `${event.tenants?.email ?? event.tenant_email_snapshot ?? '-'} - ${event.tenants?.cpf ?? event.tenant_cpf_snapshot ?? event.tenant_id ?? '-'}`
}

function getDueDate(payment: PlatformPaymentHistory) {
  const value =
    payment.payload?.due_date ??
    payment.payload?.dueDate ??
    payment.payload?.vencimento

  return value ? String(value) : formatDateTime(payment.created_at)
}

export default function PlatformPaymentHistoryPage() {
  const router = useRouter()

  const [payments, setPayments] = useState<PlatformPaymentHistory[]>([])
  const [billingEvents, setBillingEvents] = useState<BillingEvent[]>([])
  const [from, setFrom] = useState(dateDaysAgo(90))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

    const response = await fetch(`/api/platform/payment-history?${params.toString()}`, {
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
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar histórico de pagamentos.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setPayments(data.payments ?? [])
    setBillingEvents(data.billingEvents ?? [])
    setLoading(false)
  }, [from, router, status, to])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredPayments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return payments

    return payments.filter((payment) => {
      const tenant = payment.tenants

      return [
        tenant?.legal_name,
        tenant?.email,
        tenant?.cpf,
        tenant?.whatsapp_e164,
        payment.asaas_payment_id,
        payment.id,
        payment.status,
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
    })
  }, [payments, query])

  const stats = useMemo(() => {
    return {
      total: filteredPayments.length,
      paid: filteredPayments.filter((payment) => payment.status === 'paid').length,
      amount: filteredPayments
        .filter((payment) => payment.status === 'paid')
        .reduce((sum, payment) => sum + payment.amount_cents, 0),
      billingEvents: billingEvents.length,
    }
  }, [billingEvents.length, filteredPayments])

  function exportPdf() {
    window.print()
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
            <button
              onClick={() => router.push('/platform/payments')}
              className="text-sm text-gray-500"
            >
              Voltar
            </button>
            <button
              onClick={exportPdf}
              className="h-9 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
            >
              Exportar PDF
            </button>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Histórico de pagamentos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Consulte pagamentos da plataforma confirmados, pendentes e excluidos.
              </p>
              <p className="mt-2 hidden text-xs text-gray-500 print:block">
                Periodo: {from} ate {to} - Status: {statusLabel(status)}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[520px] print:hidden">
              <label className="text-sm font-medium">
                Inicio
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

              <label className="text-sm font-medium">
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Registros</p>
            <p className="mt-1 text-2xl font-bold">{stats.total}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Pagos</p>
            <p className="mt-1 text-2xl font-bold">{stats.paid}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Eventos de cobranca</p>
            <p className="mt-1 text-2xl font-bold">{stats.billingEvents}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <div className="mb-4 print:hidden">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm md:max-w-md"
              placeholder="Buscar por negócio, CPF, e-mail ou pagamento"
            />
          </div>

          {filteredPayments.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              Nenhum pagamento encontrado no periodo.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredPayments.map((payment) => (
                <article
                  key={payment.id}
                  className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[minmax(0,1fr)_180px_180px]"
                >
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {payment.tenants?.legal_name ?? 'Negócio sem nome'}
                    </div>
                    <div className="mt-1 break-words text-sm text-gray-500">
                      {payment.tenants?.email ?? '-'} - {payment.tenants?.cpf ?? payment.tenant_id}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Criado em {formatDateTime(payment.created_at)} - Vencimento {getDueDate(payment)}
                    </div>
                    {payment.latest_event && (
                      <div className="mt-2 text-xs text-gray-500">
                        Ultimo evento: {sourceLabel(payment.latest_event.source)} em {formatDateTime(payment.latest_event.created_at)}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-bold">{formatMoney(payment.amount_cents)}</div>
                    <div className="text-xs text-gray-500">
                      {payment.billing_type || payment.provider || 'Cobranca'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Confirmado: {formatDateTime(payment.confirmed_at)}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="h-7 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {statusLabel(payment.status)}
                    </span>
                    <span className="h-7 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                      {sourceLabel(payment.confirmed_source || payment.latest_event?.source || null)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-bold">Eventos de cobranca</h2>
            <span className="text-sm text-gray-500">{formatMoney(stats.amount)} recebidos</span>
          </div>

          {billingEvents.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              Nenhuma pausa ou ativacao de cobranca no periodo.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {billingEvents.map((event) => (
                <article
                  key={event.id}
                  className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[minmax(0,1fr)_220px]"
                >
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {eventTenantName(event)}
                    </div>
                    <div className="mt-1 break-words text-sm text-gray-500">
                      {eventTenantContact(event)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {event.note || 'Status de cobrança alterado.'}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="h-7 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {event.event_type === 'tenant_deleted'
                        ? 'Negócio excluído'
                        : `${statusLabel(event.old_status || '')} para ${statusLabel(event.new_status)}`}
                    </span>
                    <span className="h-7 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                      {formatDateTime(event.created_at)}
                    </span>
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
