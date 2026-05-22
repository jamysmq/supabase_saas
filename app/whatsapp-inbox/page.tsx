'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'

type Thread = {
  id: string
  customer_phone_e164: string
  customer_name_snapshot: string | null
  status: 'open' | 'closed'
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
}

type Message = {
  id: string
  direction: 'inbound' | 'outbound' | 'system'
  sender_type: string
  status: string
  body: string
  created_at: string
}

function formatPhone(value: string) {
  const digits = String(value ?? '').replace(/\D/g, '')

  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4)
    const rest = digits.slice(4)
    return `+55 ${ddd} ${rest}`
  }

  return digits || '-'
}

function formatDateTime(value: string | null) {
  if (!value) return '-'

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function WhatsAppInboxPage() {
  const router = useRouter()
  const [accessToken, setAccessToken] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  )

  const loadMessages = useCallback(async function loadMessages(threadId: string, token = accessToken) {
    if (!token) return

    setLoadingMessages(true)
    setError('')

    const response = await fetch(`/api/tenant-whatsapp/threads/${threadId}/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setLoadingMessages(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel carregar as mensagens.')
      return
    }

    const payload = await response.json()
    setMessages(payload.messages ?? [])
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId ? { ...thread, unread_count: 0 } : thread
      )
    )
  }, [accessToken])

  const loadThreads = useCallback(async function loadThreads(token = accessToken) {
    if (!token) return []

    setError('')

    const response = await fetch('/api/tenant-whatsapp/threads', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel carregar as conversas.')
      return []
    }

    const payload = await response.json()
    const nextThreads: Thread[] = payload.threads ?? []
    setThreads(nextThreads)
    return nextThreads
  }, [accessToken])

  const loadInitialThreads = useCallback(async function loadInitialThreads(token: string) {
    const nextThreads = await loadThreads(token)

    if (nextThreads.length > 0) {
      setSelectedThreadId(nextThreads[0].id)
      await loadMessages(nextThreads[0].id, token)
    }
  }, [loadMessages, loadThreads])

  useEffect(() => {
    async function load() {
      const result = await getCurrentTenantUser()

      if (!result) {
        router.push('/login')
        return
      }

      if (result.tenantUser.must_change_password) {
        router.push('/change-password')
        return
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.push('/login')
        return
      }

      setAccessToken(session.access_token)
      await loadInitialThreads(session.access_token)
      setLoading(false)
    }

    void load()
  }, [loadInitialThreads, router])

  async function selectThread(threadId: string) {
    setSelectedThreadId(threadId)
    setSuccess('')
    await loadMessages(threadId)
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault()

    if (!selectedThread || !reply.trim() || !accessToken) return

    setSending(true)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/tenant-whatsapp/threads/${selectedThread.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: reply }),
    })

    setSending(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel enviar a mensagem.')
      return
    }

    setReply('')
    setSuccess('Mensagem enviada.')
    await Promise.all([
      loadThreads(),
      loadMessages(selectedThread.id),
    ])
  }

  async function closeThread() {
    if (!selectedThread || !accessToken) return

    setError('')
    setSuccess('')

    const response = await fetch(`/api/tenant-whatsapp/threads/${selectedThread.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'closed' }),
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel encerrar a conversa.')
      return
    }

    setSuccess('Conversa encerrada.')
    setSelectedThreadId(null)
    setMessages([])
    await loadThreads()
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
            onClick={() => router.push('/dashboard')}
            className="mb-3 text-sm text-gray-500"
          >
            Voltar
          </button>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Atendimento WhatsApp</h1>
              <p className="mt-1 text-sm text-gray-500">
                Responda clientes que pediram ajuda humana pelo WhatsApp.
              </p>
            </div>
            <button
              onClick={() => loadThreads()}
              className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium"
            >
              Atualizar
            </button>
          </div>
        </section>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <section className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_1fr]">
          <aside className="overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-gray-100 p-4">
              <h2 className="font-bold">Conversas abertas</h2>
            </div>

            {threads.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                Nenhuma conversa aberta.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => selectThread(thread.id)}
                    className={`block w-full p-4 text-left hover:bg-gray-50 ${
                      selectedThreadId === thread.id ? 'bg-gray-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">
                        {thread.customer_name_snapshot || formatPhone(thread.customer_phone_e164)}
                      </div>
                      {thread.unread_count > 0 && (
                        <span className="rounded-full bg-gray-950 px-2 py-0.5 text-xs font-semibold text-white">
                          {thread.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {formatPhone(thread.customer_phone_e164)}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                      {thread.last_message_preview || '-'}
                    </p>
                    <p className="mt-2 text-xs text-gray-400">
                      {formatDateTime(thread.last_message_at)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="flex min-h-[620px] flex-col overflow-hidden rounded-2xl bg-white shadow">
            {!selectedThread ? (
              <div className="flex flex-1 items-center justify-center p-6 text-sm text-gray-500">
                Selecione uma conversa.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 border-b border-gray-100 p-4">
                  <div>
                    <h2 className="font-bold">
                      {selectedThread.customer_name_snapshot || formatPhone(selectedThread.customer_phone_e164)}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {formatPhone(selectedThread.customer_phone_e164)}
                    </p>
                  </div>
                  <button
                    onClick={closeThread}
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium"
                  >
                    Encerrar
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {loadingMessages ? (
                    <div className="text-sm text-gray-500">Carregando mensagens...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-sm text-gray-500">Nenhuma mensagem registrada.</div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${
                          message.direction === 'outbound' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                            message.direction === 'outbound'
                              ? 'bg-gray-950 text-white'
                              : 'bg-white text-gray-950'
                          }`}
                        >
                          <p className="whitespace-pre-wrap leading-6">{message.body}</p>
                          <p
                            className={`mt-2 text-xs ${
                              message.direction === 'outbound' ? 'text-gray-300' : 'text-gray-400'
                            }`}
                          >
                            {formatDateTime(message.created_at)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendReply} className="border-t border-gray-100 p-4">
                  <label className="block text-sm font-medium">
                    Resposta
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      className="mt-2 min-h-28 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 font-normal"
                      maxLength={4096}
                      required
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="mt-3 w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
                  >
                    {sending ? 'Enviando...' : 'Enviar pelo WhatsApp'}
                  </button>
                </form>
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
