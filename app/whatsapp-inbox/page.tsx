'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, PointerEvent } from 'react'
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

type EntryLink = {
  code: string
  prefilled_text: string
  whatsapp_url: string | null
  platform_phone_configured: boolean
}

type MessageTemplate = {
  id: string | null
  template_key: string
  title: string
  description: string
  channel: string
  content: string
  is_active: boolean
  updated_at: string | null
}

type TemplateVariable = {
  token: string
  label: string
  description: string
}

type TemplateEditorHandle = {
  insertVariable: (variable: TemplateVariable) => void
}

const templateVariables: TemplateVariable[] = [
  {
    token: '{{tenant_name}}',
    label: 'Nome do negócio',
    description: 'Nome público do seu negócio na mensagem.',
  },
  {
    token: '{{customer_name}}',
    label: 'Nome do cliente',
    description: 'Nome do cliente, aluno ou contato atendido.',
  },
  {
    token: '{{amount}}',
    label: 'Valor',
    description: 'Valor da cobrança já formatado em reais.',
  },
  {
    token: '{{due_date}}',
    label: 'Vencimento',
    description: 'Data de vencimento da cobrança.',
  },
  {
    token: '{{pix_key}}',
    label: 'Chave Pix',
    description: 'Chave Pix configurada em Configurações.',
  },
]

const variablesByToken = new Map(
  templateVariables.map((variable) => [variable.token, variable])
)

const variablePattern = /({{[a-z_]+}})/g

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderTemplateHtml(value: string) {
  return String(value ?? '')
    .split(variablePattern)
    .map((part) => {
      const variable = variablesByToken.get(part)

      if (!variable) return escapeHtml(part).replace(/\n/g, '<br>')

      return `<span class="inline-flex items-center rounded-md border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800" contenteditable="false" draggable="true" data-token="${variable.token}" title="${escapeHtml(variable.description)}">${escapeHtml(variable.label)}</span>`
    })
    .join('')
}

function serializeTemplateNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''

  if (node instanceof HTMLBRElement) return '\n'

  if (node instanceof HTMLElement) {
    const token = node.dataset.token

    if (token) return token

    const value = Array.from(node.childNodes).map(serializeTemplateNode).join('')

    if (node instanceof HTMLDivElement || node instanceof HTMLParagraphElement) {
      return `${value}\n`
    }

    return value
  }

  return ''
}

function serializeTemplateEditor(element: HTMLElement) {
  return Array.from(element.childNodes)
    .map(serializeTemplateNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function snapshotTemplates(templates: MessageTemplate[]) {
  return JSON.stringify(
    templates
      .map((template) => ({
        template_key: template.template_key,
        content: template.content,
        is_active: template.is_active,
      }))
      .sort((left, right) => left.template_key.localeCompare(right.template_key))
  )
}

function createVariableChip(variable: TemplateVariable) {
  const chip = document.createElement('span')
  chip.className = 'inline-flex cursor-grab items-center rounded-md border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-800'
  chip.contentEditable = 'false'
  chip.draggable = true
  chip.dataset.token = variable.token
  chip.title = variable.description
  chip.textContent = variable.label
  return chip
}

function getDropRange(event: DragEvent<HTMLElement>, editor: HTMLElement) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {
      offsetNode: Node
      offset: number
    } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }

  if (documentWithCaret.caretPositionFromPoint) {
    const position = documentWithCaret.caretPositionFromPoint(event.clientX, event.clientY)

    if (position && editor.contains(position.offsetNode)) {
      const range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
      range.collapse(true)
      return range
    }
  }

  if (documentWithCaret.caretRangeFromPoint) {
    const range = documentWithCaret.caretRangeFromPoint(event.clientX, event.clientY)

    if (range && editor.contains(range.startContainer)) {
      return range
    }
  }

  const range = document.createRange()
  range.selectNodeContents(editor)
  range.collapse(false)
  return range
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

function TemplateEditor({
  value,
  onChange,
  onFocusEditor,
  registerEditor,
}: {
  value: string
  onChange: (value: string) => void
  onFocusEditor: () => void
  registerEditor: (handle: TemplateEditorHandle | null) => void
}) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)

  const rememberSelection = useCallback(() => {
    const editor = editorRef.current
    const selection = window.getSelection()

    if (!editor || !selection || selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)

    if (
      editor.contains(range.startContainer) &&
      editor.contains(range.endContainer)
    ) {
      savedRangeRef.current = range.cloneRange()
    }
  }, [])

  const sync = useCallback(() => {
    if (!editorRef.current) return
    return serializeTemplateEditor(editorRef.current)
  }, [])

  useEffect(() => {
    const editor = editorRef.current

    if (!editor || document.activeElement === editor) return

    editor.innerHTML = renderTemplateHtml(value)
  }, [value])

  const insertVariable = useCallback((variable: TemplateVariable) => {
    const editor = editorRef.current
    const selection = window.getSelection()

    if (!editor || !selection) return

    editor.focus()

    let range = savedRangeRef.current

    if (!range || !editor.contains(range.startContainer)) {
      range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
    }

    range.deleteContents()

    const chip = createVariableChip(variable)
    const trailingSpace = document.createTextNode(' ')
    range.insertNode(trailingSpace)
    range.insertNode(chip)
    range.setStartAfter(trailingSpace)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    savedRangeRef.current = range.cloneRange()

    const nextValue = sync()
    if (typeof nextValue === 'string') onChange(nextValue)
  }, [onChange, sync])

  useEffect(() => {
    registerEditor({ insertVariable })
    return () => registerEditor(null)
  }, [insertVariable, registerEditor])

  function handleDragStart(event: DragEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    const token = target.dataset.token

    if (!token) return

    event.dataTransfer.setData('text/plain', token)
    event.dataTransfer.setData('application/x-template-token', token)
    event.dataTransfer.effectAllowed = 'copy'
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()

    const token =
      event.dataTransfer.getData('application/x-template-token') ||
      event.dataTransfer.getData('text/plain')
    const variable = variablesByToken.get(token)

    if (!variable) return

    const editor = editorRef.current
    const selection = window.getSelection()

    if (!editor || !selection) return

    const range = getDropRange(event, editor)
    range.deleteContents()
    const trailingSpace = document.createTextNode(' ')
    range.insertNode(trailingSpace)
    range.insertNode(createVariableChip(variable))
    range.setStartAfter(trailingSpace)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    const nextValue = sync()
    if (typeof nextValue === 'string') onChange(nextValue)
  }

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={() => {
        const nextValue = sync()
        if (typeof nextValue === 'string') onChange(nextValue)
        rememberSelection()
      }}
      onFocus={() => {
        onFocusEditor()
        rememberSelection()
      }}
      onKeyUp={rememberSelection}
      onMouseUp={rememberSelection}
      onTouchEnd={rememberSelection}
      onBlur={() => {
        rememberSelection()
        const nextValue = sync()
        if (typeof nextValue === 'string') {
          onChange(nextValue)
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragStart={handleDragStart}
      onDrop={handleDrop}
      className="mt-2 min-h-36 w-full cursor-text overflow-y-auto rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal leading-6 outline-none focus:border-gray-400"
    />
  )
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
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [nextMessagesBefore, setNextMessagesBefore] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [clearingMessages, setClearingMessages] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [entryLink, setEntryLink] = useState<EntryLink | null>(null)
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [confirmCloseSettings, setConfirmCloseSettings] = useState(false)
  const [savedTemplatesSnapshot, setSavedTemplatesSnapshot] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [savingTemplates, setSavingTemplates] = useState(false)
  const [activeTemplateKey, setActiveTemplateKey] = useState<string | null>(null)
  const [hasCoarsePointer, setHasCoarsePointer] = useState(false)
  const templateEditorRefs = useRef(new Map<string, TemplateEditorHandle>())
  const skipNextVariableClickRef = useRef(false)
  const messagesViewportRef = useRef<HTMLDivElement | null>(null)
  const shouldScrollToLatestRef = useRef(false)

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  )
  const hasUnsavedTemplateChanges = useMemo(
    () => snapshotTemplates(messageTemplates) !== savedTemplatesSnapshot,
    [messageTemplates, savedTemplatesSnapshot]
  )

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = () => setHasCoarsePointer(query.matches)

    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
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

  const loadMessages = useCallback(async function loadMessages(
    threadId: string,
    token = accessToken,
    options: { before?: string; prepend?: boolean } = {}
  ) {
    if (!token) return

    if (options.prepend) {
      setLoadingOlderMessages(true)
    } else {
      shouldScrollToLatestRef.current = true
      setLoadingMessages(true)
    }
    setError('')

    const query = new URLSearchParams({ limit: '30' })
    if (options.before) query.set('before', options.before)

    const response = await fetch(`/api/tenant-whatsapp/threads/${threadId}/messages?${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (options.prepend) {
      setLoadingOlderMessages(false)
    } else {
      setLoadingMessages(false)
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel carregar as mensagens.')
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
      current.map((thread) =>
        thread.id === threadId ? { ...thread, unread_count: 0 } : thread
      )
    )
  }, [accessToken])

  async function loadOlderMessages() {
    if (!selectedThreadId || !nextMessagesBefore || loadingOlderMessages) return
    await loadMessages(selectedThreadId, accessToken, {
      before: nextMessagesBefore,
      prepend: true,
    })
  }

  const loadThreads = useCallback(async function loadThreads(token = accessToken) {
    if (!token) return []

    setError('')

    const response = await fetch('/api/tenant-whatsapp/threads?status=all', {
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

  const loadEntryLink = useCallback(async function loadEntryLink(token = accessToken) {
    if (!token) return

    const response = await fetch('/api/tenant-whatsapp/link', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel carregar o link de atendimento.')
      return
    }

    setEntryLink(await response.json())
  }, [accessToken])

  const loadMessageTemplates = useCallback(async function loadMessageTemplates(token = accessToken) {
    if (!token) return

    setLoadingTemplates(true)
    setError('')

    const response = await fetch('/api/tenant-message-templates', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setLoadingTemplates(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Não foi possível carregar as configurações de mensagens.')
      return
    }

    const payload = await response.json()
    const templates = payload.templates ?? []
    setMessageTemplates(templates)
    setSavedTemplatesSnapshot(snapshotTemplates(templates))
  }, [accessToken])

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
      await Promise.all([
        loadEntryLink(session.access_token),
        loadInitialThreads(session.access_token),
        loadMessageTemplates(session.access_token),
      ])
      setLoading(false)
    }

    void load()
  }, [loadEntryLink, loadInitialThreads, loadMessageTemplates, router])

  function updateMessageTemplate(templateKey: string, content: string) {
    setConfirmCloseSettings(false)
    setMessageTemplates((current) =>
      current.map((template) =>
        template.template_key === templateKey
          ? { ...template, content }
          : template
      )
    )
  }

  const registerTemplateEditor = useCallback((
    templateKey: string,
    handle: TemplateEditorHandle | null
  ) => {
    if (handle) {
      templateEditorRefs.current.set(templateKey, handle)
      return
    }

    templateEditorRefs.current.delete(templateKey)
  }, [])

  function insertVariableIntoActiveTemplate(variable: TemplateVariable) {
    const targetKey = activeTemplateKey ?? messageTemplates[0]?.template_key ?? null

    if (!targetKey) return

    const editor = templateEditorRefs.current.get(targetKey)

    if (editor) {
      editor.insertVariable(variable)
      setActiveTemplateKey(targetKey)
      return
    }

    const currentContent =
      messageTemplates.find((template) => template.template_key === targetKey)?.content ?? ''
    updateMessageTemplate(targetKey, `${currentContent} ${variable.token}`.trim())
  }

  function insertVariableFromPointer(
    event: PointerEvent<HTMLButtonElement>,
    variable: TemplateVariable
  ) {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return

    event.preventDefault()
    skipNextVariableClickRef.current = true
    insertVariableIntoActiveTemplate(variable)
  }

  function insertVariableFromClick(variable: TemplateVariable) {
    if (skipNextVariableClickRef.current) {
      skipNextVariableClickRef.current = false
      return
    }

    insertVariableIntoActiveTemplate(variable)
  }

  function openSettings() {
    setConfirmCloseSettings(false)
    setShowSettings(true)
  }

  function requestCloseSettings() {
    if (savingTemplates) return

    if (hasUnsavedTemplateChanges) {
      setConfirmCloseSettings(true)
      return
    }

    setShowSettings(false)
  }

  async function discardTemplateChanges() {
    setConfirmCloseSettings(false)
    setShowSettings(false)
    await loadMessageTemplates()
  }

  async function copyEntryLink() {
    if (!entryLink) return

    const value = entryLink.whatsapp_url ?? entryLink.prefilled_text

    try {
      await navigator.clipboard.writeText(value)
      setSuccess(entryLink.whatsapp_url
        ? 'Link exclusivo copiado. Agora é só compartilhá-lo com seus clientes.'
        : 'Mensagem de entrada copiada. Agora é só compartilhá-la com seus clientes.')
      setError('')
    } catch {
      setError('Não foi possível copiar automaticamente.')
    }
  }

  async function selectThread(threadId: string) {
    setSelectedThreadId(threadId)
    setSuccess('')
    await loadMessages(threadId)
  }

  async function saveMessageTemplates(event: FormEvent) {
    event.preventDefault()

    if (!accessToken) return

    setSavingTemplates(true)
    setError('')
    setSuccess('')

    const response = await fetch('/api/tenant-message-templates', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        templates: messageTemplates.map((template) => ({
          template_key: template.template_key,
          content: template.content,
          is_active: template.is_active,
        })),
      }),
    })

    setSavingTemplates(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Não foi possível salvar as mensagens.')
      return
    }

    setSuccess('Configurações de mensagens atualizadas.')
    setSavedTemplatesSnapshot(snapshotTemplates(messageTemplates))
    setConfirmCloseSettings(false)
    setShowSettings(false)
    await loadMessageTemplates()
  }

  async function sendReply(event: FormEvent) {
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
    setSuccess('Mensagem enviada. O atendimento automático ficará pausado por duas horas.')
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
    setHasMoreMessages(false)
    setNextMessagesBefore(null)
    await loadThreads()
  }

  async function clearThreadMessages() {
    if (!selectedThread || !accessToken || clearingMessages) return

    const confirmed = window.confirm('Limpar todas as mensagens desta conversa sem encerra-la?')

    if (!confirmed) return

    setClearingMessages(true)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/tenant-whatsapp/threads/${selectedThread.id}/messages`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    setClearingMessages(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Nao foi possivel limpar a conversa.')
      return
    }

    setMessages([])
    setHasMoreMessages(false)
    setNextMessagesBefore(null)
    setSuccess('Conversa limpa.')
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
            <div className="flex flex-wrap gap-2">
              <button
                hidden
                onClick={openSettings}
                className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium"
              >
                Configurações
              </button>
              <button
                onClick={() => loadThreads()}
                className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-medium"
              >
                Atualizar
              </button>
            </div>
          </div>
        </section>

        {entryLink && (
          <section className="rounded-2xl bg-white p-5 shadow">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-bold">Link exclusivo de atendimento</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Compartilhe este link nas redes sociais, no seu site ou diretamente com seus clientes. Ao abri-lo, a pessoa verá uma mensagem pronta e será direcionada automaticamente para o atendimento do seu negócio pelo Jack.
                </p>
                <p className="mt-3 break-all rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {entryLink.whatsapp_url ?? entryLink.prefilled_text}
                </p>
                <p className="mt-2 text-xs text-gray-400">
                  Código de roteamento: {entryLink.code}
                </p>
                {!entryLink.platform_phone_configured && (
                  <p className="mt-2 text-xs text-amber-700">
                    Configure WHATSAPP_PUBLIC_PHONE_E164 para gerar o link wa.me automaticamente.
                  </p>
                )}
              </div>
              <button
                onClick={copyEntryLink}
                className="h-10 shrink-0 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white"
              >
                Copiar link de atendimento
              </button>
            </div>
          </section>
        )}

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

        <section className="grid gap-4 lg:h-[680px] lg:grid-cols-[360px_1fr]">
          <aside className="flex max-h-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow">
            <div className="border-b border-gray-100 p-4">
              <h2 className="font-bold">Conversas</h2>
            </div>

            {threads.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">
                Nenhuma conversa aberta.
              </div>
            ) : (
              <div className="divide-y divide-gray-100 overflow-y-auto">
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
                      {thread.unread_count === 0 && thread.status === 'closed' && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          Encerrada
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

          <section className="flex h-[680px] min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow">
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
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={clearThreadMessages}
                      disabled={clearingMessages}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      {clearingMessages ? 'Limpando...' : 'Limpar'}
                    </button>
                    <button
                      type="button"
                      onClick={closeThread}
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium"
                    >
                      Encerrar
                    </button>
                  </div>
                </div>

                <div ref={messagesViewportRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                  {loadingMessages ? (
                    <div className="text-sm text-gray-500">Carregando mensagens...</div>
                  ) : messages.length === 0 ? (
                    <div className="text-sm text-gray-500">Nenhuma mensagem registrada.</div>
                  ) : (
                    <>
                      {hasMoreMessages && (
                        <div className="flex justify-center pb-1">
                          <button
                            type="button"
                            onClick={loadOlderMessages}
                            disabled={loadingOlderMessages}
                            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 shadow-sm disabled:opacity-60"
                          >
                            {loadingOlderMessages ? 'Carregando...' : 'Mais mensagens'}
                          </button>
                        </div>
                      )}
                      {messages.map((message) => (
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
                      ))}
                    </>
                  )}
                </div>

                <form onSubmit={sendReply} className="border-t border-gray-100 p-4">
                  <label className="block text-sm font-medium">
                    Resposta
                    <textarea
                      value={reply}
                      onChange={(event) => setReply(event.target.value)}
                      className="mt-2 min-h-20 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 font-normal"
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

        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:px-4 sm:py-6">
            <div className="h-[100dvh] max-h-[100dvh] w-full max-w-4xl overflow-y-auto rounded-none bg-white shadow-xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
              <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white p-4 sm:items-center sm:p-5">
                <div>
                  <h2 className="text-lg font-bold">Configurações do WhatsApp</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Personalize a mensagem de cobrança enviada aos seus clientes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={requestCloseSettings}
                  onPointerUp={(event) => {
                    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
                      event.preventDefault()
                      requestCloseSettings()
                    }
                  }}
                  className="min-h-10 shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium"
                >
                  Fechar
                </button>
              </div>

              <form onSubmit={saveMessageTemplates} className="space-y-5 p-5">
                {confirmCloseSettings && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <p className="font-semibold">Existem alterações não salvas.</p>
                    <p className="mt-1">
                      Salve as mensagens antes de fechar ou descarte as alterações feitas nesta janela.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <button
                        type="submit"
                        disabled={savingTemplates}
                        className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {savingTemplates ? 'Salvando...' : 'Salvar alterações'}
                      </button>
                      <button
                        type="button"
                        onClick={discardTemplateChanges}
                        disabled={savingTemplates}
                        className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 disabled:opacity-50"
                      >
                        Sair sem salvar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmCloseSettings(false)}
                        className="rounded-lg px-4 py-2 text-sm font-medium text-amber-900"
                      >
                        Continuar editando
                      </button>
                    </div>
                  </div>
                )}

                {loadingTemplates ? (
                  <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
                    Carregando mensagens...
                  </div>
                ) : messageTemplates.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
                    A mensagem de cobrança não está disponível no plano atual.
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold">Campos dinâmicos</h3>
                      <p className="mt-1 text-xs text-gray-500">
                        Toque ou arraste um campo para dentro da mensagem. No editor ele fica travado para evitar alteração acidental do código.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {templateVariables.map((variable) => (
                          <button
                            key={variable.token}
                            type="button"
                            draggable={!hasCoarsePointer}
                            onClick={() => insertVariableFromClick(variable)}
                            onPointerUp={(event) => insertVariableFromPointer(event, variable)}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', variable.token)
                              event.dataTransfer.setData('application/x-template-token', variable.token)
                              event.dataTransfer.effectAllowed = 'copy'
                            }}
                            className="cursor-pointer rounded-lg border border-gray-200 bg-gray-50 p-3 text-left active:cursor-grabbing sm:cursor-grab"
                            title={variable.token}
                          >
                            <span className="block text-sm font-semibold text-gray-900">
                              {variable.label}
                            </span>
                            <span className="mt-1 block text-xs text-gray-500">
                              {variable.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      {messageTemplates.map((template) => (
                        <label key={template.template_key} className="block text-sm font-medium">
                          {template.title}
                          <span className="mt-1 block text-xs font-normal text-gray-500">
                            {template.description}
                          </span>
                          <TemplateEditor
                            value={template.content}
                            onChange={(content) =>
                              updateMessageTemplate(template.template_key, content)
                            }
                            onFocusEditor={() => setActiveTemplateKey(template.template_key)}
                            registerEditor={(handle) =>
                              registerTemplateEditor(template.template_key, handle)
                            }
                          />
                        </label>
                      ))}
                    </div>

                    <button
                      type="submit"
                      disabled={savingTemplates}
                      className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
                    >
                      {savingTemplates ? 'Salvando...' : 'Salvar mensagens'}
                    </button>
                  </>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
