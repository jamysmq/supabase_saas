'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
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

type StaticPixDetails = {
  billing_cycle_id: string
  customer_name: string
  due_date: string
  amount_cents: number
  beneficiary_name: string
  beneficiary_city: string
  txid: string
  payload: string
  qr_data_url: string
  confirmation_mode: 'manual'
}

export default function PendingPaymentsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [items, setItems] = useState<PendingPayment[]>([])
  const [deactivatingCustomerId, setDeactivatingCustomerId] = useState('')
  const [loadingPixId, setLoadingPixId] = useState('')
  const [pixDetails, setPixDetails] = useState<StaticPixDetails | null>(null)
  const [pixCopied, setPixCopied] = useState(false)
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

  async function openPix(billingCycleId: string) {
    setLoadingPixId(billingCycleId)
    setPixCopied(false)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setLoadingPixId('')
      router.push('/login')
      return
    }

    const response = await fetch(`/api/pending-payments/${billingCycleId}/pix`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })
    const payload = await response.json().catch(() => null)

    setLoadingPixId('')

    if (!response.ok) {
      alert(payload?.message || 'Não foi possível gerar o QR Pix.')
      return
    }

    setPixDetails(payload.pix)
  }

  async function copyPixPayload() {
    if (!pixDetails) return

    try {
      await navigator.clipboard.writeText(pixDetails.payload)
      setPixCopied(true)
    } catch {
      alert('Não foi possível copiar automaticamente. Selecione o código e copie manualmente.')
    }
  }

  async function deactivateCustomer(customerId: string) {
    const confirmed = confirm(
      `Tem certeza que deseja desativar este ${labels.customerSingular.toLowerCase()}?`
    )

    if (!confirmed) return

    setDeactivatingCustomerId(customerId)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setDeactivatingCustomerId('')
      router.push('/login')
      return
    }

    const response = await fetch(`/api/tenant-customers/${customerId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: false }),
    })

    setDeactivatingCustomerId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      alert(data?.message || `Não foi possível desativar o ${labels.customerSingular.toLowerCase()}.`)
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
              onClick={() => router.push('/financeiro?from=pending-payments')}
              className="text-sm font-medium text-gray-950 underline"
            >
              Financeiro
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
              className="grid gap-3 border-b border-gray-100 p-4 last:border-b-0 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_240px] md:items-center"
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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 md:grid-cols-1">
                <button
                  onClick={() => void openPix(item.billing_cycle_id)}
                  disabled={loadingPixId === item.billing_cycle_id}
                  className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingPixId === item.billing_cycle_id ? 'Gerando...' : 'Pix / QR Code'}
                </button>

                <button
                  onClick={() => confirmPayment(item.billing_cycle_id)}
                  className="h-9 rounded-lg bg-gray-950 px-3 text-xs font-medium text-white"
                >
                  Confirmar
                </button>

                <button
                  onClick={() => void deactivateCustomer(item.customer_id)}
                  disabled={deactivatingCustomerId === item.customer_id}
                  className="h-9 rounded-lg bg-red-50 px-3 text-xs font-medium text-red-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {deactivatingCustomerId === item.customer_id ? 'Aguarde...' : 'Desativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {pixDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pix-dialog-title"
          onClick={() => setPixDetails(null)}
        >
          <section
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pix-dialog-title" className="text-xl font-bold">Pix da cobrança</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {pixDetails.customer_name} · {formatMoney(pixDetails.amount_cents)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPixDetails(null)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium"
              >
                Fechar
              </button>
            </div>

            <div className="mt-5 flex justify-center">
              <Image
                src={pixDetails.qr_data_url}
                width={360}
                height={360}
                alt={`QR Pix da cobrança de ${pixDetails.customer_name}`}
                className="h-auto w-full max-w-[320px] rounded-xl border border-gray-100"
                unoptimized
              />
            </div>

            <dl className="mt-4 grid gap-2 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Beneficiário</dt>
                <dd className="font-medium">{pixDetails.beneficiary_name}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Vencimento</dt>
                <dd className="font-medium">{pixDetails.due_date}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-gray-500">Referência Pix</dt>
                <dd className="break-all font-mono text-xs">{pixDetails.txid}</dd>
              </div>
            </dl>

            <label className="mt-4 block text-sm font-medium">
              Pix Copia e Cola
              <textarea
                value={pixDetails.payload}
                readOnly
                rows={4}
                className="mt-1 w-full resize-none rounded-lg border border-gray-200 p-3 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>

            <button
              type="button"
              onClick={() => void copyPixPayload()}
              className="mt-3 w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white"
            >
              {pixCopied ? 'Código copiado!' : 'Copiar código Pix'}
            </button>

            <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              Este QR usa a chave do estabelecimento e não confirma o pagamento automaticamente.
              Após conferir o recebimento, faça a baixa manual nesta página.
            </p>
          </section>
        </div>
      )}
    </main>
  )
}
