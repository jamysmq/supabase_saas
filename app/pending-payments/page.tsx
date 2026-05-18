'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'

type PendingPayment = {
  billing_cycle_id: string
  customer_id: string
  customer_name: string
  phone: string
  due_date: string
  amount_cents: number
  status: string
  message_sent_at: string | null
}

export default function PendingPaymentsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [items, setItems] = useState<PendingPayment[]>([])
  const [error, setError] = useState('')
  const labels = getBusinessLabels(businessType)

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

    setBusinessType(result.tenant?.business_type ?? null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/pending-payments', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      setError('Não foi possível carregar os pagamentos pendentes.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setItems(data.payments ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function confirmPayment(billingCycleId: string) {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(`/api/pending-payments/${billingCycleId}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        note: 'Confirmado pelo painel',
      }),
    })

    if (!response.ok) {
      alert('Não foi possível confirmar o pagamento.')
      return
    }

    await load()
  }

  async function deactivateCustomer(customerId: string) {
    const confirmed = confirm(
      `Tem certeza que deseja desativar este ${labels.customerSingular.toLowerCase()}?`
    )

    if (!confirmed) return

    const { error } = await supabase.rpc(
      'admin_deactivate_customer',
      {
        p_customer_id: customerId,
        p_reason: 'Desativado pelo painel',
      }
    )

    if (error) {
      alert(`Não foi possível desativar o ${labels.customerSingular.toLowerCase()}.`)
      return
    }

    await load()
  }

function formatMoney(amountCents: number) {
    return (amountCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
  })
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    overdue: 'Pendente',
    paid_manual: 'Pago',
    canceled: 'Cancelado',
  }

  return labels[status] ?? status
}

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-sm text-gray-500"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push('/payment-history?from=pending-payments')}
              className="text-sm font-medium text-gray-950 underline"
            >
              Histórico
            </button>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                Pagamentos pendentes
              </h1>

              <p className="text-sm text-gray-600 mt-1">
                Confirme pagamentos recebidos ou desative {labels.customerPluralLower}.
              </p>
            </div>

            <span className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
              {items.length} pendentes
            </span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {items.length === 0 && (
          <div className="bg-white rounded-2xl shadow p-8 text-center text-sm text-gray-600">
            Nenhum pagamento pendente no momento.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-white shadow">
          {items.map((item) => (
            <div
              key={item.billing_cycle_id}
              className="grid gap-3 border-b border-gray-100 p-4 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_220px] md:items-center"
            >
              <div className="min-w-0">
                <h2 className="break-words text-sm font-bold">
                  {item.customer_name}
                </h2>

                <p className="mt-1 break-words text-xs text-gray-500">
                  Telefone: {item.phone}
                </p>
              </div>

              <div className="min-w-0">
                <p className="text-xs text-gray-600">
                  Vencimento: {item.due_date}
                </p>

                <p className="text-xs text-gray-600">
                  Valor: {formatMoney(item.amount_cents)}
                </p>

                <p className="text-xs text-gray-500">
                  Status: {statusLabel(item.status)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:justify-end">
                <button
                  onClick={() => confirmPayment(item.billing_cycle_id)}
                  className="h-9 rounded-lg bg-gray-950 px-3 text-xs font-medium text-white md:w-28"
                >
                  Confirmar
                </button>

                <button
                  onClick={() => deactivateCustomer(item.customer_id)}
                  className="h-9 rounded-lg bg-red-50 px-3 text-xs font-medium text-red-700 md:w-28"
                >
                  Desativar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
