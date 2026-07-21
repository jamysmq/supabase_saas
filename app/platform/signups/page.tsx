'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'

type PendingSignup = Record<string, unknown>

function textValue(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  return String(value)
}

function getPaymentId(signup: PendingSignup) {
  return textValue(
    signup.payment_id ?? signup.wa_payment_id ?? signup.id,
    ''
  )
}

function getName(signup: PendingSignup) {
  return textValue(
    signup.legal_name ??
      signup.name ??
      signup.tenant_name ??
      signup.customer_name,
    'Sem nome'
  )
}

function getContact(signup: PendingSignup) {
  return textValue(
    signup.email ?? signup.whatsapp_e164 ?? signup.chat_id ?? signup.phone,
    'Sem contato'
  )
}

function getAmount(signup: PendingSignup) {
  const amount = signup.amount_cents

  if (typeof amount !== 'number') return '-'

  return (amount / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export default function PlatformSignupsPage() {
  const router = useRouter()

  const [signups, setSignups] = useState<PendingSignup[]>([])
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

    const response = await fetch('/api/platform/signups', {
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
      setError('Não foi possível carregar cadastros pendentes.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setSignups(data.signups ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredSignups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return signups

    return signups.filter((signup) => (
      JSON.stringify(signup).toLowerCase().includes(normalizedQuery)
    ))
  }, [signups, query])

  async function postAction(paymentId: string, action: 'confirm' | 'cancel') {
    const confirmed = confirm(
      action === 'confirm'
        ? 'Confirmar este cadastro e pagamento?'
        : 'Cancelar este cadastro pendente?'
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

    const response = await fetch(`/api/platform/signups/${paymentId}/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    setActingId('')

    if (!response.ok) {
      setError(
        action === 'confirm'
          ? 'Não foi possível confirmar o cadastro.'
          : 'Não foi possível cancelar o cadastro.'
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
          <button
            onClick={() => router.push('/platform/tenants')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Novas contas pendentes</h1>
              <p className="text-sm text-gray-500 mt-1">
                Revise solicitações institucionais para criar novas contas na plataforma.
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
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="Buscar em novas contas pendentes"
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">Cadastro</th>
                  <th className="py-3 pr-4 font-medium">Contato</th>
                  <th className="py-3 pr-4 font-medium">Valor</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Pagamento</th>
                  <th className="py-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>

              <tbody>
                {filteredSignups.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">
                      Nenhum cadastro pendente.
                    </td>
                  </tr>
                ) : (
                  filteredSignups.map((signup, index) => {
                    const paymentId = getPaymentId(signup)

                    return (
                      <tr key={paymentId || index} className="border-b border-gray-100">
                        <td className="py-3 pr-4 font-medium">
                          <div className="text-xs font-normal text-sky-700">
                            {textValue(signup.plan_name || signup.plan)}
                          </div>
                          <div>{getName(signup)}</div>
                          <div className="text-xs font-normal text-gray-400">
                            {textValue(signup.cpf ?? signup.document)}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-gray-600">
                          {getContact(signup)}
                        </td>
                        <td className="py-3 pr-4 text-gray-600">
                          {getAmount(signup)}
                        </td>
                        <td className="py-3 pr-4 text-gray-600">
                          {textValue(signup.status)}
                        </td>
                        <td className="py-3 pr-4 text-gray-600">
                          {paymentId || '-'}
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => router.push(`/platform/signups/${paymentId}`)}
                              disabled={!paymentId}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                            >
                              Detalhes
                            </button>
                            <button
                              onClick={() => void postAction(paymentId, 'confirm')}
                              disabled={!paymentId || actingId === paymentId}
                              className="rounded-lg bg-gray-950 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => void postAction(paymentId, 'cancel')}
                              disabled={!paymentId || actingId === paymentId}
                              className="rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
