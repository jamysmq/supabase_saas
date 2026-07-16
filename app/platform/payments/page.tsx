'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'

type PaymentTenant = {
  legal_name: string
  email: string
  cpf: string
  whatsapp_e164: string
  business_type: string | null
  plan: string
}

type PlatformPayment = {
  id: string
  tenant_id: string
  subscription_id: string | null
  provider: string
  asaas_payment_id: string | null
  amount_cents: number
  billing_type: string | null
  status: string
  payload: Record<string, unknown> | null
  created_at: string
  confirmed_at: string | null
  tenants: PaymentTenant | null
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

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function getDueDate(payment: PlatformPayment) {
  return textValue(
    payment.payload?.due_date ??
      payment.payload?.dueDate ??
      payment.payload?.vencimento,
    formatDate(payment.created_at)
  )
}

export default function PlatformPaymentsPage() {
  const router = useRouter()

  const [payments, setPayments] = useState<PlatformPayment[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState('')
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

    const response = await fetch('/api/platform/payments', {
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
      setError('Não foi possível carregar pagamentos pendentes.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setPayments(data.payments ?? [])
    setLoading(false)
  }, [router])

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
      ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery))
    })
  }, [payments, query])

  async function postAction(paymentId: string, action: 'confirm' | 'delete') {
    const confirmed = confirm(
      action === 'confirm'
        ? 'Confirmar este pagamento pendente?'
        : 'Excluir este pagamento pendente?'
    )

    if (!confirmed) return

    setActingId(paymentId)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(
      action === 'confirm'
        ? `/api/platform/payments/${paymentId}/confirm`
        : `/api/platform/payments/${paymentId}`,
      {
        method: action === 'confirm' ? 'POST' : 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: action === 'confirm' ? JSON.stringify({}) : undefined,
      }
    )

    setActingId('')

    if (!response.ok) {
      setError(
        action === 'confirm'
          ? 'Não foi possível confirmar o pagamento.'
          : 'Não foi possível excluir o pagamento.'
      )
      return
    }

    await load()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => router.push('/platform/tenants')}
              className="text-sm text-gray-500"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push('/platform/payment-history')}
              className="text-sm font-medium text-gray-950 underline"
            >
              Historico
            </button>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Pagamentos pendentes</h1>
              <p className="text-sm text-gray-500 mt-1">
                Confirme ou exclua cobranças mensais pendentes dos negócios.
              </p>
            </div>

            <button
              onClick={() => void load()}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium"
            >
              Atualizar
            </button>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm md:max-w-md"
              placeholder="Buscar por negócio, CPF, e-mail ou pagamento"
            />

            <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              {filteredPayments.length} pendentes
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Negócio</th>
                  <th className="py-3 pr-4 font-medium">Contato</th>
                  <th className="py-3 pr-4 font-medium">Valor</th>
                  <th className="py-3 pr-4 font-medium">Vencimento</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>

              <tbody>
                {filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Nenhum pagamento pendente.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment) => (
                    <tr key={payment.id} className="border-b border-gray-100">
                      <td className="py-3 pr-4 font-medium">
                        <div>{payment.tenants?.legal_name ?? 'Negócio sem nome'}</div>
                        <div className="text-xs font-normal text-gray-400">
                          {payment.tenants?.cpf ?? payment.tenant_id}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        <div>{payment.tenants?.email ?? '-'}</div>
                        <div className="text-xs text-gray-400">
                          {payment.tenants?.whatsapp_e164 ?? '-'}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {formatMoney(payment.amount_cents)}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {getDueDate(payment)}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                          {payment.status}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => void postAction(payment.id, 'confirm')}
                            disabled={actingId === payment.id}
                            className="rounded-lg bg-gray-950 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Confirmar
                          </button>
                          <button
                            onClick={() => void postAction(payment.id, 'delete')}
                            disabled={actingId === payment.id}
                            className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                          >
                            Excluir
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
