'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../src/lib/supabase'

type SignupDetail = {
  detail: unknown
  authPayload: unknown
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export default function PlatformSignupDetailPage() {
  const router = useRouter()
  const params = useParams<{ paymentId: string }>()
  const paymentId = params.paymentId

  const [detail, setDetail] = useState<SignupDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
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

    const response = await fetch(`/api/platform/signups/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (response.status === 401) {
      router.push('/login')
      return
    }

    if (!response.ok) {
      setError('Nao foi possivel carregar o detalhe do cadastro.')
      setLoading(false)
      return
    }

    setDetail(await response.json())
    setLoading(false)
  }, [paymentId, router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function postAction(action: 'confirm' | 'cancel') {
    const confirmed = confirm(
      action === 'confirm'
        ? 'Confirmar este cadastro e pagamento?'
        : 'Cancelar este cadastro pendente?'
    )

    if (!confirmed) return

    setActing(true)
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

    setActing(false)

    if (!response.ok) {
      setError(
        action === 'confirm'
          ? 'Nao foi possivel confirmar o cadastro.'
          : 'Nao foi possivel cancelar o cadastro.'
      )
      return
    }

    router.push('/platform/signups')
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
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            onClick={() => router.push('/platform/signups')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Detalhe do cadastro</h1>
              <p className="text-sm text-gray-500 mt-1">
                Pagamento: {paymentId}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => void postAction('confirm')}
                disabled={acting}
                className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Confirmar
              </button>
              <button
                onClick={() => void postAction('cancel')}
                disabled={acting}
                className="rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-2xl shadow p-5 space-y-3">
            <h2 className="font-bold">Signup</h2>
            <JsonBlock value={detail?.detail ?? null} />
          </div>

          <div className="bg-white rounded-2xl shadow p-5 space-y-3">
            <h2 className="font-bold">Payload Auth</h2>
            <JsonBlock value={detail?.authPayload ?? null} />
          </div>
        </section>
      </div>
    </main>
  )
}
