'use client'

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../../src/lib/supabase'

type Thread = {
  id: string
  customer_phone_e164: string
  status: string
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
}

type Message = {
  id: string
  thread_id: string
  direction: 'inbound' | 'outbound'
  sender_type: string
  body: string
  created_at: string
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function PlatformWhatsAppInboxPage() {
  const router = useRouter()
  const [accessToken, setAccessToken] = useState('')
  const [threads, setThreads] = useState<Thread[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [nextMessagesBefore, setNextMessagesBefore] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollToLatestRef = useRef(false)

  const loadMessages = useCallback(async (
    threadId: string,
    token: string,
    options: { before?: string; prepend?: boolean } = {}
  ) => {
    if (options.prepend) setLoadingOlderMessages(true)
    else {
      shouldScrollToLatestRef.current = true
      setLoadingMessages(true)
    }

    const query = new URLSearchParams({ thread_id: threadId, limit: '30' })
    if (options.before) query.set('before', options.before)

    const response = await fetch(`/api/platform/whatsapp-inbox?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (options.prepend) setLoadingOlderMessages(false)
    else setLoadingMessages(false)

    if (!response.ok) {
      setError('Não foi possível carregar as mensagens.')
      return
    }

    const payload = await response.json()
    const nextMessages: Message[] = payload.messages ?? []
    setMessages((current) => {
      if (!options.prepend) return nextMessages
      const currentIds = new Set(current.map((message) => message.id))
      return [...nextMessages.filter((message) => !currentIds.has(message.id)), ...current]
    })
    setHasMoreMessages(payload.has_more === true)
    setNextMessagesBefore(payload.next_before ?? null)
    setThreads((current) =>
      current.map((thread) => thread.id === threadId ? { ...thread, unread_count: 0 } : thread)
    )
  }, [])

  useEffect(() => {
    if (!shouldScrollToLatestRef.current || loadingMessages || messages.length === 0) return

    const frame = window.requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
      shouldScrollToLatestRef.current = false
    })

    return () => window.cancelAnimationFrame(frame)
  }, [loadingMessages, messages])

  const loadThreads = useCallback(async (token: string, keepSelection = true) => {
    const response = await fetch('/api/platform/whatsapp-inbox', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status === 401) {
      router.push('/login')
      return []
    }
    if (!response.ok) {
      setError('Não foi possível carregar a caixa do WhatsApp.')
      return []
    }

    const payload = await response.json()
    const nextThreads: Thread[] = payload.threads ?? []
    setThreads(nextThreads)
    if (!keepSelection) setSelectedId('')
    return nextThreads
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.push('/login')

      setAccessToken(session.access_token)
      const nextThreads = await loadThreads(session.access_token)
      const firstThreadId = nextThreads[0]?.id ?? ''
      setSelectedId(firstThreadId)
      if (firstThreadId) await loadMessages(firstThreadId, session.access_token)
      setLoading(false)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [loadMessages, loadThreads, router])

  const selected = threads.find((thread) => thread.id === selectedId)

  async function selectThread(threadId: string) {
    setSelectedId(threadId)
    setMessages([])
    setHasMoreMessages(false)
    setNextMessagesBefore(null)
    setError('')
    setSuccess('')
    await loadMessages(threadId, accessToken)
  }

  async function loadOlderMessages() {
    if (!selectedId || !nextMessagesBefore || loadingOlderMessages) return
    await loadMessages(selectedId, accessToken, {
      before: nextMessagesBefore,
      prepend: true,
    })
  }

  async function refresh() {
    if (!accessToken) return
    const nextThreads = await loadThreads(accessToken)
    const nextSelectedId = nextThreads.some((thread) => thread.id === selectedId)
      ? selectedId
      : nextThreads[0]?.id ?? ''
    setSelectedId(nextSelectedId)
    if (nextSelectedId) await loadMessages(nextSelectedId, accessToken)
  }

  async function archive() {
    if (!selected || !accessToken) return
    await fetch('/api/platform/whatsapp-inbox', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: selected.id, status: 'archived' }),
    })
    await refresh()
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !reply.trim() || sending || !accessToken) return

    setSending(true)
    setError('')
    setSuccess('')
    const response = await fetch('/api/platform/whatsapp-inbox', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: selected.id, body: reply.trim() }),
    })
    const payload = await response.json().catch(() => null)
    setSending(false)

    if (!response.ok) {
      setError(payload?.error || 'Não foi possível enviar a mensagem pelo WhatsApp.')
      return
    }

    setReply('')
    setSuccess('Mensagem enviada pelo Jack. O atendimento automático ficará pausado por duas horas.')
    if (payload?.message) {
      shouldScrollToLatestRef.current = true
      setMessages((current) => [...current, payload.message])
    }
    await loadThreads(accessToken)
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-100">Carregando...</main>
  }

  return (
    <main className="min-h-screen bg-gray-100 p-4 text-gray-950">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="rounded-2xl bg-white p-5 shadow">
          <button onClick={() => router.push('/platform/tenants')} className="mb-3 text-sm text-gray-500">
            Voltar
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">WhatsApp do Jack</h1>
              <p className="mt-1 text-sm text-gray-500">
                Conversas institucionais ainda não vinculadas a um cliente da plataforma.
              </p>
            </div>
            <button onClick={refresh} className="rounded-lg border px-4 py-2 text-sm">
              Atualizar
            </button>
          </div>
        </header>

        {error && <div className="rounded-xl bg-red-50 p-4 text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-green-50 p-4 text-green-700">{success}</div>}

        <section className="grid gap-4 lg:h-[680px] lg:grid-cols-[340px_1fr]">
          <aside className="flex max-h-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b p-4">
              <h2 className="font-bold">Conversas institucionais</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {threads.length === 0 ? (
                <p className="p-6 text-sm text-gray-500">Nenhuma conversa institucional.</p>
              ) : threads.map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => selectThread(thread.id)}
                  className={`block w-full border-b p-4 text-left ${selectedId === thread.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex justify-between gap-3">
                    <strong>+{thread.customer_phone_e164}</strong>
                    {thread.unread_count > 0 && (
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                        {thread.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-500">
                    {thread.last_message_preview || 'Sem mensagem'}
                  </p>
                </button>
              ))}
            </div>
          </aside>

          <section className="flex h-[680px] min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow">
            {!selected ? (
              <div className="m-auto text-sm text-gray-500">Selecione uma conversa.</div>
            ) : (
              <>
                <div className="flex items-center justify-between border-b p-4">
                  <div>
                    <strong>+{selected.customer_phone_e164}</strong>
                    <div className="text-xs text-gray-500">Atendimento institucional</div>
                  </div>
                  <button onClick={archive} className="rounded-lg border px-3 py-2 text-sm">
                    Arquivar
                  </button>
                </div>

                <div ref={messagesViewportRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {loadingMessages ? (
                    <p className="text-sm text-gray-500">Carregando mensagens...</p>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-gray-500">Nenhuma mensagem registrada.</p>
                  ) : (
                    <>
                      {hasMoreMessages && (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            onClick={loadOlderMessages}
                            disabled={loadingOlderMessages}
                            className="rounded-full border bg-white px-4 py-2 text-xs font-semibold shadow-sm disabled:opacity-60"
                          >
                            {loadingOlderMessages ? 'Carregando...' : 'Mais mensagens'}
                          </button>
                        </div>
                      )}
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`max-w-[80%] rounded-xl p-3 text-sm shadow-sm ${message.direction === 'outbound' ? 'ml-auto bg-green-100' : 'bg-white'}`}
                        >
                          <p className="whitespace-pre-wrap">{message.body}</p>
                          <time className="mt-2 block text-right text-[11px] text-gray-500">
                            {formatDateTime(message.created_at)}
                          </time>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <form onSubmit={sendReply} className="border-t p-4">
                  <label htmlFor="platform-reply" className="mb-2 block text-sm font-medium">
                    Responder como equipe do Jack
                  </label>
                  <div className="flex gap-3">
                    <textarea
                      id="platform-reply"
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      maxLength={4096}
                      rows={2}
                      placeholder="Digite sua mensagem para este contato..."
                      className="min-h-16 flex-1 resize-y rounded-xl border border-gray-300 p-3 text-sm outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={sending || !reply.trim()}
                      className="self-end rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? 'Enviando...' : 'Enviar'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    A resposta manual pausa o atendimento automático por duas horas.
                  </p>
                </form>
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
