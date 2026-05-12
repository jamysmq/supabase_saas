'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'

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

    setBusinessType(result.tenant?.business_type ?? null)

    const { data, error } = await supabase.rpc(
      'admin_list_pending_customer_payments',
      {
        p_tenant_id: result.tenantUser.tenant_id,
      }
    )

    if (error) {
      setError('Não foi possível carregar os pagamentos pendentes.')
      setLoading(false)
      return
    }

    setItems(data ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function confirmPayment(billingCycleId: string) {
    const { error } = await supabase.rpc(
      'admin_confirm_customer_payment',
      {
        p_billing_cycle_id: billingCycleId,
        p_note: 'Confirmado pelo professor no painel',
      }
    )

    if (error) {
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
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-500 mb-3"
          >
            ← Voltar
          </button>

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

        <div className="grid gap-4 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.billing_cycle_id}
              className="bg-white rounded-2xl shadow p-5 space-y-3"
            >
              <div>
                <h2 className="font-bold text-lg">
                  {item.customer_name}
                </h2>

                <p className="text-sm text-gray-600">
                  Telefone: {item.phone}
                </p>

                <p className="text-sm text-gray-600">
                  Vencimento: {item.due_date}
                </p>

                <p className="text-sm text-gray-600">
                  Valor: {formatMoney(item.amount_cents)}
                </p>

                <p className="text-xs text-gray-500">
                  Status: {item.status}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => confirmPayment(item.billing_cycle_id)}
                  className="w-full rounded-lg bg-gray-950 text-white py-2 font-medium"
                >
                  Confirmar pagamento
                </button>

                <button
                  onClick={() => deactivateCustomer(item.customer_id)}
                  className="w-full rounded-lg bg-red-50 text-red-700 py-2 font-medium"
                >
                  Desativar {labels.customerSingular.toLowerCase()}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
