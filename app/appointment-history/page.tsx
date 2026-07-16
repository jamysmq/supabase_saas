'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseAppointments } from '../../src/lib/plan-features'
import { openNativePicker } from '../../src/lib/open-native-picker'

type HistoryAppointment = {
  appointment_id: string
  customer_name: string | null
  customer_cpf: string | null
  customer_phone_e164: string | null
  customer_birth_date: string | null
  service_name: string | null
  staff_member_name: string | null
  starts_at: string
  ends_at: string
  status: string
  title: string | null
  notes: string | null
  source: string
  deleted_at: string | null
  latest_status_old: string | null
  latest_status_new: string | null
  latest_status_source: string | null
  latest_status_note: string | null
  latest_status_changed_at: string | null
}

const statusOptions = [
  { value: '', label: 'Todos' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'completed', label: 'Concluido' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'no_show', label: 'Faltou' },
  { value: 'deleted', label: 'Excluido' },
]

function statusLabel(status: string) {
  return statusOptions.find((option) => option.value === status)?.label ?? status
}

function sourceLabel(source: string | null) {
  const labels: Record<string, string> = {
    panel: 'Painel',
    panel_delete: 'Excluido no painel',
    whatsapp: 'WhatsApp',
    n8n: 'WhatsApp',
  }

  return labels[source || ''] ?? source ?? 'Origem não informada'
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

function dateDaysAgo(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

export default function AppointmentHistoryPage() {
  const router = useRouter()

  const [appointments, setAppointments] = useState<HistoryAppointment[]>([])
  const [from, setFrom] = useState(dateDaysAgo(30))
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState('')
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

    if (!tenantCanUseAppointments(result.tenant?.plan)) {
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

    const response = await fetch(`/api/appointment-history?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar o histórico.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setAppointments(data.appointments ?? [])
    setLoading(false)
  }, [from, router, status, to])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const stats = useMemo(() => {
    return {
      total: appointments.length,
      completed: appointments.filter((appointment) => appointment.status === 'completed').length,
      cancelled: appointments.filter((appointment) => appointment.status === 'cancelled' || appointment.deleted_at).length,
    }
  }, [appointments])

  function exportPdf() {
    window.print()
  }

  function getBackHref() {
    const searchParams = new URLSearchParams(window.location.search)
    return searchParams.get('from') === 'dashboard'
      ? '/dashboard'
      : '/appointments'
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
              onClick={() => router.push(getBackHref())}
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
              <h1 className="text-2xl font-bold">Histórico de agendamentos</h1>
              <p className="mt-1 text-sm text-gray-500">
                Consulte atendimentos passados, cancelados, faltas e exclusões.
              </p>
              <p className="mt-2 hidden text-xs text-gray-500 print:block">
                Período: {from} até {to} - Status: {statusLabel(status)}
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
            <p className="text-sm text-gray-500">Concluidos</p>
            <p className="mt-1 text-2xl font-bold">{stats.completed}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow print:rounded-none print:border print:border-gray-200 print:p-3 print:shadow-none">
            <p className="text-sm text-gray-500">Cancelados/excluídos</p>
            <p className="mt-1 text-2xl font-bold">{stats.cancelled}</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          {appointments.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              Nenhum registro encontrado no período.
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {appointments.map((appointment) => (
                <article
                  key={appointment.appointment_id}
                  className="grid gap-3 py-4 print:break-inside-avoid lg:grid-cols-[190px_minmax(0,1fr)_180px]"
                >
                  <div>
                    <div className="text-sm font-bold">
                      {formatDateTime(appointment.starts_at)}
                    </div>
                    <div className="text-xs text-gray-500">
                      até {formatDateTime(appointment.ends_at)}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {appointment.customer_name || appointment.title || 'Sem pessoa'}
                    </div>
                    <div className="mt-1 break-words text-sm text-gray-500">
                      {appointment.customer_phone_e164 || 'Sem WhatsApp'} - {appointment.service_name || 'Sem serviço'} - {appointment.staff_member_name || 'Sem profissional'}
                    </div>
                    {appointment.notes && (
                      <div className="mt-1 break-words text-xs text-gray-500">
                        {appointment.notes}
                      </div>
                    )}
                    {appointment.latest_status_changed_at && (
                      <div className="mt-2 text-xs text-gray-500">
                        Última mudança: {statusLabel(appointment.latest_status_old || '')} para {statusLabel(appointment.latest_status_new || '')} em {formatDateTime(appointment.latest_status_changed_at)}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <span className="h-7 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                      {appointment.deleted_at ? 'Excluido' : statusLabel(appointment.status)}
                    </span>
                    <span className="h-7 rounded-full bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                      {sourceLabel(appointment.source)}
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
