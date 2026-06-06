'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'

type ContactMessage = {
  id: string
  name: string
  email: string
  whatsapp_e164: string | null
  subject: string | null
  body: string
  status: 'new' | 'read' | 'archived'
  source: string
  created_at: string
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

function formatPhone(value: string | null) {
  if (!value) return '-'
  const digits = value.replace(/\D/g, '')
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+55 ${digits.slice(2, 4)} ${digits.slice(4)}`
  }
  return digits || '-'
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    new: 'Nova',
    read: 'Lida',
    archived: 'Arquivada',
  }

  return labels[status] ?? status
}

export default function PlatformContactMessagesPage() {
  const router = useRouter()

  const [messages, setMessages] = useState<ContactMessage[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
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

    const params = new URLSearchParams({ status: statusFilter })
    const response = await fetch(`/api/platform/contact-messages?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (response.status === 401) {
      router.push('/login')
      return
    }

    if (response.status === 403) {
      setError('Seu usuario nao tem permissao de administrador da plataforma.')
      setLoading(false)
      return
    }

    if (!response.ok) {
      setError('Nao foi possivel carregar as mensagens.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setMessages(data.messages ?? [])
    setLoading(false)
  }, [router, statusFilter])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredMessages = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return messages

    return messages.filter((message) => (
      message.name.toLowerCase().includes(normalized) ||
      message.email.toLowerCase().includes(normalized) ||
      String(message.subject ?? '').toLowerCase().includes(normalized) ||
      message.body.toLowerCase().includes(normalized) ||
      String(message.whatsapp_e164 ?? '').includes(normalized)
    ))
  }, [messages, query])

  async function updateStatus(messageId: string, status: 'read' | 'archived') {
    setActingId(messageId)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/platform/contact-messages', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: messageId, status }),
    })

    setActingId('')

    if (!response.ok) {
      setError('Nao foi possivel atualizar a mensagem.')
      return
    }

    await load()
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow">
          <button
            onClick={() => router.push('/platform/tenants')}
            className="mb-3 text-sm text-gray-500"
          >
            Voltar
          </button>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Mensagens recebidas</h1>
              <p className="mt-1 text-sm text-gray-500">
                Mensagens enviadas pelo card Falar conosco da pagina inicial.
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

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="rounded-2xl bg-white p-5 shadow">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
              placeholder="Buscar por nome, contato, assunto ou mensagem"
            />

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
            >
              <option value="active">Novas e lidas</option>
              <option value="new">Novas</option>
              <option value="read">Lidas</option>
              <option value="archived">Arquivadas</option>
              <option value="all">Todas</option>
            </select>
          </div>

          <div className="mt-4 divide-y divide-gray-100">
            {filteredMessages.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                Nenhuma mensagem encontrada.
              </p>
            ) : (
              filteredMessages.map((message) => (
                <article key={message.id} className="grid gap-3 py-4 lg:grid-cols-[190px_minmax(0,1fr)_160px]">
                  <div>
                    <div className="text-sm font-bold">{formatDateTime(message.created_at)}</div>
                    <div className="mt-1 text-xs text-gray-500">{statusLabel(message.status)}</div>
                  </div>

                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold">
                      {message.name}
                    </div>
                    <div className="mt-1 break-words text-xs text-gray-500">
                      {message.email} | {formatPhone(message.whatsapp_e164)}
                    </div>
                    {message.subject && (
                      <div className="mt-2 break-words text-sm font-medium">
                        {message.subject}
                      </div>
                    )}
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                      {message.body}
                    </p>
                  </div>

                  <div className="flex gap-2 lg:flex-col">
                    {message.status === 'new' && (
                      <button
                        onClick={() => void updateStatus(message.id, 'read')}
                        disabled={actingId === message.id}
                        className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-50"
                      >
                        Marcar lida
                      </button>
                    )}
                    {message.status !== 'archived' && (
                      <button
                        onClick={() => void updateStatus(message.id, 'archived')}
                        disabled={actingId === message.id}
                        className="rounded-lg bg-gray-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
