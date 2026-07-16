import { createTenantAdminClient } from '../../../../src/lib/tenant-admin'
import {
  WhatsAppCloudConfigError,
  WhatsAppCloudSendError,
  WhatsAppCloudValidationError,
  createWhatsAppCloudClient,
  getWhatsAppCloudConfigFromEnv,
} from '../../../../src/lib/whatsapp-cloud'
import {
  type WhatsAppWebhookMessageEvent,
  normalizeWhatsAppWebhookPayload,
  verifyMetaWebhookSignature,
} from '../../../../src/lib/whatsapp-webhook'

function jsonResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

type InboxRoute = {
  messageId: string
  threadId: string
  scope: 'tenant' | 'platform'
}

type N8nRouterResponse = {
  route?: unknown
  reason?: unknown
  reply_text?: unknown
  dispatch_to_module?: unknown
  target_webhook_path?: unknown
  inbox_thread_id?: unknown
  inbox_routed?: unknown
  tenant_candidates?: unknown
  tenant_plan?: unknown
  tenant_id?: unknown
  tenant_name?: unknown
}

type N8nForwardReply = {
  messageId: string
  threadId: string | null
  body: string
  providerMessageId: string | null
}

function normalizeN8nReplyText(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= 4096 ? text : ''
}

async function loadPlatformPlansReply() {
  try {
    const supabase = createTenantAdminClient()
    const { data, error } = await supabase
      .from('platform_plans')
      .select('name, description')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !data?.length) return ''

    const plans = data.map((plan) => {
      const description = String(plan.description ?? '').trim()
      return '*' + plan.name + '*\n' + description
    })

    return 'O Jack é um assistente virtual no WhatsApp conectado a uma plataforma de gestão. Ele atende clientes, organiza cobranças e agenda, recebe pedidos e, nos planos de catálogo, também ajuda no controle de estoque.\n\n*Conheça os planos do Jack:*\n\n' + plans.join('\n\n') + '\n\nEscolha abaixo se deseja se cadastrar ou voltar ao Menu do Jack.'
  } catch (error) {
    console.error('WhatsApp platform plans could not be loaded.', error)
    return ''
  }
}

function normalizeN8nThreadId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null
}

function normalizeShortLabel(value: unknown, fallback: string) {
  const label = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return label ? label.slice(0, 120) : fallback
}

const humanHandoffButtonTitle = 'Atendimento humano'

type TenantHumanContact = {
  name: string
  whatsappUrl: string | null
}

async function loadTenantHumanContact(tenantId: unknown): Promise<TenantHumanContact | null> {
  if (typeof tenantId !== 'string' || !tenantId.trim()) return null

  try {
    const supabase = createTenantAdminClient()
    const { data, error } = await supabase
      .from('tenants')
      .select('legal_name, public_name, whatsapp_e164')
      .eq('id', tenantId)
      .eq('status', 'active')
      .maybeSingle()

    if (error || !data) return null

    const name = normalizeShortLabel(data.public_name || data.legal_name, 'este estabelecimento')
    const tenantPhone = String(data.whatsapp_e164 ?? '').replace(/\D/g, '')
    const jackPhone = String(process.env.WHATSAPP_PUBLIC_PHONE_E164 ?? '').replace(/\D/g, '')

    if (tenantPhone.length < 10 || tenantPhone === jackPhone) {
      return { name, whatsappUrl: null }
    }

    const greeting = `Ol\u00e1! Vim pelo Assistente Jack e gostaria de falar com a equipe de ${name}.`
    return {
      name,
      whatsappUrl: `https://wa.me/${tenantPhone}?text=${encodeURIComponent(greeting)}`,
    }
  } catch (error) {
    console.error('Could not load the tenant WhatsApp contact.', error)
    return null
  }
}

function isPlatformMenuResponse(response: N8nRouterResponse | null) {
  return response?.route === 'platform_menu'
}

function normalizeTenantCandidates(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 10)
}

function tenantMenuButtons(plan: unknown) {
  if (plan === 'plan1') {
    return [
      { id: 'tenant_billing', title: 'Cadastro e cobranças' },
      { id: 'tenant_handoff', title: humanHandoffButtonTitle },
      { id: 'main_menu', title: 'Menu do Jack' },
    ]
  }

  if (plan === 'plan2') {
    return [
      { id: 'tenant_appointments', title: 'Agendamentos' },
      { id: 'tenant_handoff', title: humanHandoffButtonTitle },
      { id: 'main_menu', title: 'Menu do Jack' },
    ]
  }

  if (plan === 'plan3') {
    return [
      { id: 'tenant_appointments', title: 'Agendamentos' },
      { id: 'tenant_billing', title: 'Cadastro e cobranças' },
      { id: 'tenant_handoff', title: humanHandoffButtonTitle },
    ]
  }

  return [
    { id: 'tenant_handoff', title: humanHandoffButtonTitle },
    { id: 'main_menu', title: 'Menu do Jack' },
  ]
}

function isAppointmentActionMenu(body: string) {
  return body.includes('O que deseja fazer?') &&
    body.includes('1) Agendar') &&
    body.includes('2) Remarcar') &&
    body.includes('3) Cancelar')
}

type AppointmentInteractiveOption = {
  id: string
  title: string
  description?: string
}

type AppointmentInteractiveReply = {
  kind: 'buttons' | 'list'
  body: string
  buttonText?: string
  options: AppointmentInteractiveOption[]
}

function billingSignupUnavailableReply(body: string, tenantName: string): AppointmentInteractiveReply | null {
  const normalized = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const unavailable = normalized.includes('nao esta recebendo novos cadastros') ||
    normalized.includes('cadastro pelo whatsapp esta temporariamente indisponivel')

  if (!unavailable) return null

  return {
    kind: 'buttons',
    body: `O cadastro automático pelo WhatsApp de *${tenantName}* está pausado no momento.\n\nPara mais informações, fale diretamente com a equipe pelo botão abaixo.`,
    options: [
      { id: 'tenant_handoff', title: humanHandoffButtonTitle },
      { id: 'main_menu', title: 'Menu do Jack' },
    ],
  }
}

function shortInteractiveTitle(value: string, maxLength: number) {
  const title = value.replace(/\s+/g, ' ').trim()
  return title.length <= maxLength ? title : `${title.slice(0, Math.max(1, maxLength - 1)).trim()}…`
}

function compactAppointmentSlotTitle(value: string) {
  const match = value.trim().match(/^([A-Za-zÀ-ÿ-]+),?\s+(\d{1,2}\/\d{1,2})\s+(?:às|as)\s+(\d{1,2}:\d{2})/i)

  if (!match) {
    const dateOnlyMatch = value.trim().match(/^(\d{1,2}\/\d{1,2})\s+(?:às|as)\s+(\d{1,2}:\d{2})/i)
    return dateOnlyMatch ? `${dateOnlyMatch[1]} às ${dateOnlyMatch[2]}` : null
  }

  const normalizedDay = match[1]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  const day = normalizedDay.startsWith('segunda')
    ? 'Seg'
    : normalizedDay.startsWith('terca')
      ? 'Ter'
      : normalizedDay.startsWith('quarta')
        ? 'Qua'
        : normalizedDay.startsWith('quinta')
          ? 'Qui'
          : normalizedDay.startsWith('sexta')
            ? 'Sex'
            : normalizedDay.startsWith('sabado')
              ? 'Sab'
              : 'Dom'

  return `${day} ${match[2]} às ${match[3]}`
}

function isAppointmentCompletionReply(body: string) {
  const normalized = body
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalized.includes('agendamento confirmado') ||
    normalized.includes('horario confirmado') ||
    normalized.includes('horario remarcado') ||
    normalized.includes('agendamento cancelado')
}

function appointmentInteractiveReply(body: string): AppointmentInteractiveReply | null {
  if (isAppointmentCompletionReply(body)) {
    return {
      kind: 'buttons',
      body,
      options: [
        { id: 'tenant_appointments', title: 'Agendamentos' },
        { id: 'tenant_handoff', title: humanHandoffButtonTitle },
        { id: 'main_menu', title: 'Menu do Jack' },
      ],
    }
  }

  if (body.includes('Confirme seu agendamento:')) {
    return {
      kind: 'buttons',
      body,
      options: [
        { id: 'appointment_confirm_yes', title: 'Confirmar' },
        { id: 'appointment_restart', title: 'Voltar \u00e0 agenda' },
      ],
    }
  }

  if (body.includes('Confira os dados antes de enviar')) {
    return {
      kind: 'buttons',
      body,
      options: [
        { id: 'billing_signup_confirm', title: 'Confirmar cadastro' },
        { id: 'billing_signup_restart', title: 'Refazer cadastro' },
      ],
    }
  }

  const lines = body.split('\n')
  const numbered = lines.flatMap((line, lineIndex) => {
    const match = line.trim().match(/^(\d+)\)\s+(.+)$/)
    return match ? [{ lineIndex, number: match[1], title: match[2].trim() }] : []
  })

  if (numbered.length === 0) return null

  const firstOptionLine = numbered[0].lineIndex
  const cleanBody = lines.slice(0, firstOptionLine).join('\n').trim() || 'Escolha uma opção:'
  const isSlotMenu = body.includes('Encontrei estes horarios') || body.includes('Encontrei estes horários')
  const normalizedBody = body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const isBillingSignupMenu = normalizedBody.includes('plano de mensalidade') ||
    normalizedBody.includes('turma desejada') || normalizedBody.includes('turma com vaga')
  const options = numbered.map((option) => {
    const compactSlotTitle = compactAppointmentSlotTitle(option.title)
    const title = isBillingSignupMenu ? `${option.number}. ${option.title}` : option.title

    return {
      id: `${isBillingSignupMenu ? 'billing_signup_choice' : 'appointment_choice'}_${option.number}`,
      title: compactSlotTitle ?? title,
      ...(compactSlotTitle ? { description: shortInteractiveTitle(option.title, 72) } : {}),
    }
  })

  if (isSlotMenu) {
    options.push({ id: 'appointment_more', title: 'Ver mais horários' })
  }

  if (options.length <= 3) {
    return {
      kind: 'buttons',
      body: cleanBody,
      options: options.map((option) => ({
        ...option,
        title: shortInteractiveTitle(option.title, 20),
      })),
    }
  }

  const buttonText = body.includes('servico') || body.includes('serviço')
    ? 'Ver serviços'
    : body.includes('profissional')
      ? 'Ver profissionais'
      : isSlotMenu
        ? 'Ver horários'
        : normalizedBody.includes('plano de mensalidade')
          ? 'Ver planos'
          : normalizedBody.includes('turma')
            ? 'Ver turmas'
            : 'Ver opções'

  return {
    kind: 'list',
    body: `${cleanBody}\n\nToque no botão abaixo para escolher.`,
    buttonText,
    options: options.map((option) => ({
      ...option,
      title: shortInteractiveTitle(option.title, 24),
    })),
  }
}

type RecentAppointmentCompletion = {
  found: boolean
  action: 'create' | 'reschedule' | 'cancel' | null
}

async function loadRecentAppointmentCompletion(tenantId: unknown, customerPhone: string): Promise<RecentAppointmentCompletion> {
  if (typeof tenantId !== 'string' || !tenantId.trim() || !customerPhone.trim()) {
    return { found: false, action: null }
  }

  try {
    const supabase = createTenantAdminClient()
    const { data, error } = await supabase
      .from('wa_conversations')
      .select('step, payload_draft')
      .eq('tenant_id', tenantId)
      .eq('chat_id', customerPhone)
      .eq('is_closed', true)
      .gte('last_message_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return { found: false, action: null }

    const payload = data.payload_draft as { appointment?: { last_action?: unknown } } | null
    const storedAction = payload?.appointment?.last_action
    const action = storedAction === 'create' || storedAction === 'reschedule' || storedAction === 'cancel'
      ? storedAction
      : data.step === 'appointment_rescheduled'
        ? 'reschedule'
        : data.step === 'appointment_cancelled'
          ? 'cancel'
          : data.step === 'appointment_created'
            ? 'create'
            : null

    return { found: true, action }
  } catch (error) {
    console.error('Could not load recent WhatsApp appointment completion.', error)
    return { found: false, action: null }
  }
}

function completedAppointmentBody(tenantName: string, action: RecentAppointmentCompletion['action']) {
  if (action === 'create') {
    return `Seu agendamento em *${tenantName}* está confirmado. 😊\n\nSe precisar ajustar esse horário ou marcar outro, toque em *Agendamentos*. Para procurar outro estabelecimento, use o *Menu do Jack*.`
  }

  if (action === 'reschedule') {
    return `Seu horário em *${tenantName}* foi remarcado com sucesso. 😊\n\nSe precisar fazer outro ajuste, toque em *Agendamentos*. Para procurar outro estabelecimento, use o *Menu do Jack*.`
  }

  if (action === 'cancel') {
    return `Seu agendamento em *${tenantName}* foi cancelado.\n\nSe quiser marcar um novo horário, toque em *Agendamentos*. Para procurar outro estabelecimento, use o *Menu do Jack*.`
  }

  return `Seu atendimento de agenda em *${tenantName}* foi concluído. 😊\n\nPara agendar, remarcar ou cancelar outro horário, toque em *Agendamentos*. Para procurar outro estabelecimento, use o *Menu do Jack*.`
}

const platformMenuBody = 'Olá! 👋 Eu sou o Jack, o seu assistente virtual. 🤖\nEstou aqui para conectar você ao que precisa de forma simples e rápida.\n\nComo posso ajudar?'
const platformMenuFallback = `${platformMenuBody}\n\n1 - Quero o Jack no meu negócio\n2 - Conhecer o que o Jack pode fazer\n3 - Encontrar um serviço ou produto\n4 - Atendimento humano`

function resolveN8nModuleUrl(routerUrl: string, targetPath: unknown) {
  const path = typeof targetPath === 'string' ? targetPath.trim().replace(/^\/+/, '') : ''

  if (!path || path.includes('://') || path.includes('..')) {
    return null
  }

  const url = new URL(routerUrl)
  url.pathname = `/webhook/${path}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function recordMessagesInInbox(messages: WhatsAppWebhookMessageEvent[]) {
  if (messages.length === 0) {
    return { attempted: false, recorded: 0, failed: 0, unrouted: 0, routes: [] as InboxRoute[] }
  }

  let supabase

  try {
    supabase = createTenantAdminClient()
  } catch (error) {
    console.error('WhatsApp inbox recording skipped: Supabase admin client is not configured.', error)
    return { attempted: false, recorded: 0, failed: messages.length, unrouted: 0, routes: [] as InboxRoute[] }
  }

  let recorded = 0
  let failed = 0
  let unrouted = 0
  const routes: InboxRoute[] = []

  for (const message of messages) {
    if (!message.text) continue

    const { data, error } = await supabase.rpc('admin_record_whatsapp_inbound', {
      p_phone_number_id: message.phoneNumberId,
      p_platform_phone_e164: message.displayPhoneNumber,
      p_customer_phone_e164: message.from,
      p_message_id: message.messageId,
      p_body: message.text,
      p_timestamp: message.timestamp,
      p_raw_event: message,
    })

    if (error) {
      failed += 1
      console.error('WhatsApp inbox recording failed.', {
        messageId: message.messageId,
        error: error.message,
      })
    } else if (data) {
      recorded += 1
      routes.push({
        messageId: message.messageId,
        threadId: String(data),
        scope: 'tenant',
      })
    } else {
      const { data: platformThreadId, error: platformError } = await supabase.rpc(
        'admin_record_platform_whatsapp_inbound',
        {
          p_customer_phone_e164: message.from,
          p_message_id: message.messageId,
          p_body: message.text,
          p_raw_event: message,
        }
      )

      if (platformError || !platformThreadId) {
        failed += 1
        console.error('WhatsApp institutional inbox recording failed.', {
          messageId: message.messageId,
          error: platformError?.message,
        })
      } else {
        unrouted += 1
        recorded += 1
        routes.push({ messageId: message.messageId, threadId: String(platformThreadId), scope: 'platform' })
      }
    }
  }

  return { attempted: true, recorded, failed, unrouted, routes }
}

async function recordAutomatedReply(threadId: string | null, scope: 'tenant' | 'platform' | null, body: string, providerMessageId: string | null, rawPayload: unknown) {
  if (!threadId) return

  let supabase

  try {
    supabase = createTenantAdminClient()
  } catch (error) {
    console.error('WhatsApp automated reply recording skipped: Supabase admin client is not configured.', error)
    return
  }

  const threadResult = scope === 'platform'
    ? await supabase.from('platform_whatsapp_threads').select('id').eq('id', threadId).single()
    : await supabase.from('tenant_whatsapp_threads').select('id, tenant_id').eq('id', threadId).single()
  const { data: thread, error: threadError } = threadResult

  if (threadError || !thread) {
    console.error('WhatsApp automated reply recording skipped: thread not found.', {
      threadId,
      error: threadError?.message,
    })
    return
  }

  const now = new Date().toISOString()
  const { error: insertError } = await supabase
    .from(scope === 'platform' ? 'platform_whatsapp_messages' : 'tenant_whatsapp_messages')
    .insert({
    thread_id: thread.id,
    ...(scope === 'platform' ? {} : { tenant_id: (thread as unknown as { tenant_id: string }).tenant_id }),
    direction: 'outbound',
    sender_type: 'bot',
    provider: 'whatsapp_cloud',
    provider_message_id: providerMessageId,
    status: 'sent',
    body,
    raw_payload: rawPayload,
    created_at: now,
  })

  if (insertError) {
    console.error('WhatsApp automated reply was sent but not recorded.', {
      threadId,
      error: insertError.message,
    })
    return
  }

  await supabase
    .from(scope === 'platform' ? 'platform_whatsapp_threads' : 'tenant_whatsapp_threads')
    .update({
      status: 'open',
      last_message_preview: body.slice(0, 240),
      last_message_at: now,
      last_outbound_at: now,
      updated_at: now,
    })
    .eq('id', thread.id)
}

async function forwardMessagesToN8n(messages: WhatsAppWebhookMessageEvent[], routes: InboxRoute[]) {
  const webhookUrl = process.env.WHATSAPP_INBOUND_N8N_WEBHOOK_URL?.trim()

  if (!webhookUrl || messages.length === 0) {
    return { attempted: false, sent: 0, failed: 0, repliesSent: 0, repliesFailed: 0, modulesDispatched: 0, moduleFailures: 0 }
  }

  const token = process.env.WHATSAPP_INBOUND_N8N_TOKEN?.trim()
  let sent = 0
  let failed = 0
  let repliesSent = 0
  let repliesFailed = 0
  let modulesDispatched = 0
  let moduleFailures = 0
  let automationSuppressed = 0
  const activeHumanTakeovers = new Set<string>()

  try {
    const supabase = createTenantAdminClient()
    const now = new Date().toISOString()
    const tenantThreadIds = [...new Set(routes.filter((route) => route.scope === 'tenant').map((route) => route.threadId))]
    const platformThreadIds = [...new Set(routes.filter((route) => route.scope === 'platform').map((route) => route.threadId))]

    if (tenantThreadIds.length > 0) {
      const { data } = await supabase
        .from('tenant_whatsapp_threads')
        .select('id')
        .in('id', tenantThreadIds)
        .gt('human_takeover_until', now)
      for (const thread of data ?? []) activeHumanTakeovers.add(`tenant:${thread.id}`)
    }

    if (platformThreadIds.length > 0) {
      const { data } = await supabase
        .from('platform_whatsapp_threads')
        .select('id')
        .in('id', platformThreadIds)
        .gt('human_takeover_until', now)
      for (const thread of data ?? []) activeHumanTakeovers.add(`platform:${thread.id}`)
    }
  } catch (error) {
    console.error('WhatsApp human takeover lookup failed.', error)
  }

  for (const message of messages) {
    if (!message.text) continue

    const route = routes.find((item) => item.messageId === message.messageId)

    if (route && activeHumanTakeovers.has(`${route.scope}:${route.threadId}`)) {
      automationSuppressed += 1
      continue
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          provider: 'whatsapp_cloud',
          phone_number_id: message.phoneNumberId,
          tenant_phone_e164: message.displayPhoneNumber,
          to: message.displayPhoneNumber,
          from: message.from,
          customer_phone_e164: message.from,
          chat_id: message.from,
          message_id: message.messageId,
          inbox_thread_id: route?.threadId ?? null,
          inbox_routed: route?.scope === 'tenant',
          inbox_scope: route?.scope ?? null,
          text: message.text,
          message: message.text,
          timestamp: message.timestamp,
          raw_event: message,
        }),
      })

      if (response.ok) {
        sent += 1
        const responseText = await response.text()
        let routerResponse: N8nRouterResponse | null = null

        try {
          routerResponse = responseText ? JSON.parse(responseText) as N8nRouterResponse : null
        } catch {
          routerResponse = null
        }

        if (
          /\bjack-[a-z0-9]{8}\b/i.test(message.text) &&
          typeof routerResponse?.tenant_id === 'string'
        ) {
          routerResponse = {
            ...routerResponse,
            route: 'tenant_menu',
            reason: 'tenant_entry_link',
            reply_text: null,
            dispatch_to_module: false,
          }
        }

        const plansReply = routerResponse?.route === 'platform_plans'
          ? await loadPlatformPlansReply()
          : ''
        const replyText = normalizeN8nReplyText(plansReply || routerResponse?.reply_text)
        const routerThreadId = normalizeN8nThreadId(routerResponse?.inbox_thread_id)
        const routerRoutedToTenant = routerResponse?.inbox_routed === true && Boolean(routerThreadId)
        const effectiveThreadId = routerRoutedToTenant ? routerThreadId : route?.threadId ?? routerThreadId
        const effectiveScope = routerRoutedToTenant
          ? 'tenant'
          : route?.scope ?? (routerThreadId ? 'tenant' : null)

        if (replyText) {
          try {
            const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
            let recordedReply = replyText
            let sendResult

            if (isPlatformMenuResponse(routerResponse)) {
              const rejectedSearch = routerResponse?.reason === 'tenant_search_rejected'
              const noSearchMatch = routerResponse?.reason === 'tenant_search_no_match'
              const interactiveMenuBody = rejectedSearch
                ? 'Tudo bem — desculpe pela confusão. 😊\n\nPosso ajudar com outra coisa?'
                : noSearchMatch
                  ? 'Desculpe, não encontrei um negócio parecido. 😕\n\nPosso ajudar com outra coisa?'
                  : platformMenuBody
              recordedReply = interactiveMenuBody
              try {
                sendResult = await client.sendButtons({
                  to: message.from,
                  body: interactiveMenuBody,
                  buttons: [
                    { id: 'platform_about', title: 'Conhecer o Jack' },
                    { id: 'tenant_search', title: 'Encontrar negócio' },
                    { id: 'human_handoff', title: humanHandoffButtonTitle },
                  ],
                })
              } catch (interactiveError) {
                console.warn('WhatsApp interactive menu failed; sending text fallback.', {
                  messageId: message.messageId,
                  error: interactiveError,
                })
                recordedReply = platformMenuFallback
                sendResult = await client.sendText({ to: message.from, body: platformMenuFallback, previewUrl: false })
              }
            } else if (routerResponse?.route === 'platform_plans') {
              sendResult = await client.sendButtons({
                to: message.from,
                body: replyText,
                buttons: [
                  { id: 'platform_signup', title: 'Cadastre-se' },
                  { id: 'main_menu', title: 'Menu do Jack' },
                ],
              })
            } else if (routerResponse?.route === 'platform_signup') {
              const signupUrl = 'https://www.meuassistentevirtual.com.br/cadastro'
              const signupBody = 'Que bom ter você por aqui! 😊 Toque abaixo para cadastrar seu negócio e escolher o plano ideal do Jack.'
              recordedReply = signupBody + '\n\n' + signupUrl
              try {
                sendResult = await client.sendCtaUrl({
                  to: message.from,
                  body: signupBody,
                  buttonText: 'Abrir cadastro',
                  url: signupUrl,
                })
              } catch (ctaError) {
                console.warn('WhatsApp signup CTA failed; sending a clickable text link.', {
                  messageId: message.messageId,
                  error: ctaError,
                })
                sendResult = await client.sendText({
                  to: message.from,
                  body: recordedReply,
                  previewUrl: true,
                })
              }
            } else if (routerResponse?.route === 'tenant_search_results') {
              const candidates = normalizeTenantCandidates(routerResponse.tenant_candidates)
              if (candidates.length > 0) {
                sendResult = await client.sendList({
                  to: message.from,
                  body: 'Encontrei alguns estabelecimentos que podem ser o que você procura. 😊\n\nToque em *Ver resultados* e escolha um deles. Se não for nenhum, você poderá voltar ao Menu do Jack.',
                  buttonText: 'Ver resultados',
                  sections: [{
                    title: 'Negócios encontrados',
                    rows: candidates.map((name, index) => ({
                      id: `tenant_choice_${index + 1}`,
                      title: name.slice(0, 24),
                    })),
                  }],
                })
                recordedReply = `Negócios encontrados: ${candidates.join(', ')}`
              } else {
                sendResult = await client.sendText({ to: message.from, body: replyText, previewUrl: false })
              }
            } else if (routerResponse?.route === 'tenant_search_confirmation') {
              sendResult = await client.sendButtons({
                to: message.from,
                body: `${replyText}\n\nConfirme abaixo para eu levar você ao atendimento correto.`,
                buttons: [
                  { id: 'tenant_confirm_yes', title: 'Sim' },
                  { id: 'tenant_confirm_no', title: 'Não' },
                ],
              })
            } else if (routerResponse?.route === 'tenant_search') {
              sendResult = await client.sendButtons({
                to: message.from,
                body: 'Claro! 😊 É só me dizer o nome do estabelecimento que você procura. Pode escrever do seu jeito — eu tentarei encontrar as opções mais parecidas.\n\nSe quiser voltar às opções gerais do Assistente Jack, toque no botão *Menu do Jack* abaixo.',
                buttons: [{ id: 'main_menu', title: 'Menu do Jack' }],
              })
            } else if (routerResponse?.route === 'tenant_human_handoff') {
              const contact = await loadTenantHumanContact(routerResponse.tenant_id)

              if (contact?.whatsappUrl) {
                const handoffBody = `Certo! Toque abaixo para falar diretamente com a equipe de *${contact.name}* no WhatsApp.`
                recordedReply = `${handoffBody}\n\n${contact.whatsappUrl}`

                try {
                  sendResult = await client.sendCtaUrl({
                    to: message.from,
                    body: handoffBody,
                    buttonText: 'Abrir WhatsApp',
                    url: contact.whatsappUrl,
                  })
                } catch (ctaError) {
                  console.warn('WhatsApp CTA URL failed; sending a clickable text link.', {
                    messageId: message.messageId,
                    error: ctaError,
                  })
                  sendResult = await client.sendText({
                    to: message.from,
                    body: recordedReply,
                    previewUrl: true,
                  })
                }
              } else {
                recordedReply = replyText
                sendResult = await client.sendText({ to: message.from, body: replyText, previewUrl: false })
              }
            } else if (routerResponse?.route === 'tenant_post_appointment') {
              const tenantName = normalizeShortLabel(routerResponse.tenant_name, 'este estabelecimento')
              const completion = await loadRecentAppointmentCompletion(routerResponse.tenant_id, message.from)
              const contextualReply = completedAppointmentBody(tenantName, completion.action)
              recordedReply = contextualReply
              sendResult = await client.sendButtons({
                to: message.from,
                body: contextualReply,
                buttons: [
                  { id: 'tenant_appointments', title: 'Agendamentos' },
                  { id: 'tenant_handoff', title: humanHandoffButtonTitle },
                  { id: 'main_menu', title: 'Menu do Jack' },
                ],
              })
            } else if (routerResponse?.route === 'tenant_menu') {
              const tenantName = normalizeShortLabel(routerResponse.tenant_name, 'este estabelecimento')
              const completion = routerResponse.reason === 'tenant_menu_invalid_choice'
                ? await loadRecentAppointmentCompletion(routerResponse.tenant_id, message.from)
                : { found: false, action: null }

              if (completion.found) {
                const contextualReply = completedAppointmentBody(tenantName, completion.action)
                recordedReply = contextualReply
                sendResult = await client.sendButtons({
                  to: message.from,
                  body: contextualReply,
                  buttons: [
                    { id: 'tenant_appointments', title: 'Agendamentos' },
                    { id: 'tenant_handoff', title: humanHandoffButtonTitle },
                    { id: 'main_menu', title: 'Menu do Jack' },
                  ],
                })
              } else {
                sendResult = await client.sendButtons({
                  to: message.from,
                  body: `Tudo certo! 😊 Agora você está no atendimento de *${tenantName}*.\n\nEu sou o Jack e vou ajudar você por aqui. Escolha abaixo o que deseja fazer.\n\nQuer atendimento de outro estabelecimento? Toque em *Menu do Jack*.`,
                  buttons: tenantMenuButtons(routerResponse.tenant_plan),
                })
              }
            } else {
              sendResult = await client.sendText({ to: message.from, body: replyText, previewUrl: false })
            }
            const reply: N8nForwardReply = {
              messageId: message.messageId,
              threadId: effectiveThreadId,
              body: recordedReply,
              providerMessageId: sendResult.messages?.[0]?.id ?? null,
            }

            await recordAutomatedReply(reply.threadId, effectiveScope, reply.body, reply.providerMessageId, {
              source: 'n8n_router_reply',
              router_response: routerResponse,
              whatsapp_response: sendResult,
            })
            repliesSent += 1
          } catch (error) {
            repliesFailed += 1

            if (
              error instanceof WhatsAppCloudConfigError ||
              error instanceof WhatsAppCloudValidationError ||
              error instanceof WhatsAppCloudSendError
            ) {
              console.error('WhatsApp n8n router reply send failed.', {
                messageId: message.messageId,
                error: error.message,
                status: error instanceof WhatsAppCloudSendError ? error.status : undefined,
                providerCode: error instanceof WhatsAppCloudSendError ? error.providerCode : undefined,
                providerMessage: error instanceof WhatsAppCloudSendError ? error.providerMessage : undefined,
              })
            } else {
              console.error('Unexpected WhatsApp n8n router reply send error.', {
                messageId: message.messageId,
                error,
              })
            }
          }
        }

        if (routerResponse?.dispatch_to_module === true) {
          const moduleUrl = resolveN8nModuleUrl(webhookUrl, routerResponse.target_webhook_path)

          if (moduleUrl) {
            const moduleResponse = await fetch(moduleUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                provider: 'whatsapp_cloud',
                tenant_id: typeof routerResponse.tenant_id === 'string' ? routerResponse.tenant_id : null,
                phone_number_id: message.phoneNumberId,
                tenant_phone_e164: message.displayPhoneNumber,
                to: message.displayPhoneNumber,
                from: message.from,
                customer_phone_e164: message.from,
                chat_id: message.from,
                message_id: message.messageId,
                inbox_thread_id: effectiveThreadId,
                inbox_routed: effectiveScope === 'tenant',
                inbox_scope: effectiveScope,
                text: message.text,
                message: message.text,
                timestamp: message.timestamp,
                raw_event: message,
              }),
            })

            const moduleReplyText = normalizeN8nReplyText(await moduleResponse.text())

            if (moduleResponse.ok) {
              modulesDispatched += 1

              if (moduleReplyText) {
                try {
                  const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
                  const tenantName = normalizeShortLabel(routerResponse.tenant_name, 'este estabelecimento')
                  const interactiveReply = billingSignupUnavailableReply(moduleReplyText, tenantName) ??
                    appointmentInteractiveReply(moduleReplyText)
                  const moduleSendResult = isAppointmentActionMenu(moduleReplyText)
                    ? await client.sendButtons({
                      to: message.from,
                      body: `Você entrou na agenda de *${tenantName}*. 📅\n\nO que deseja fazer?`,
                      buttons: [
                        { id: 'appointment_schedule', title: 'Agendar' },
                        { id: 'appointment_reschedule', title: 'Remarcar' },
                        { id: 'appointment_cancel', title: 'Cancelar' },
                      ],
                    })
                    : interactiveReply?.kind === 'buttons'
                      ? await client.sendButtons({
                        to: message.from,
                        body: interactiveReply.body,
                        buttons: interactiveReply.options,
                      })
                      : interactiveReply?.kind === 'list'
                        ? await client.sendList({
                          to: message.from,
                          body: interactiveReply.body,
                          buttonText: interactiveReply.buttonText ?? 'Ver opções',
                          sections: [{
                            title: 'Escolha uma opção',
                            rows: interactiveReply.options,
                          }],
                        })
                        : await client.sendText({ to: message.from, body: moduleReplyText, previewUrl: false })

                  await recordAutomatedReply(
                    effectiveThreadId,
                    effectiveScope,
                    moduleReplyText,
                    moduleSendResult.messages?.[0]?.id ?? null,
                    {
                      source: 'n8n_module_reply',
                      target_webhook_path: routerResponse.target_webhook_path,
                      whatsapp_response: moduleSendResult,
                    }
                  )
                  repliesSent += 1
                } catch (moduleReplyError) {
                  repliesFailed += 1
                  console.error('WhatsApp n8n module reply send failed.', {
                    messageId: message.messageId,
                    targetWebhookPath: routerResponse.target_webhook_path,
                    error: moduleReplyError,
                  })
                }
              }
            } else {
              moduleFailures += 1
              console.error('WhatsApp inbound n8n module dispatch failed.', {
                status: moduleResponse.status,
                messageId: message.messageId,
                targetWebhookPath: routerResponse.target_webhook_path,
              })

              try {
                const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
                const failureText = 'Desculpe, não consegui abrir esse atendimento agora. 😕\n\nVocê pode tentar novamente ou voltar às opções gerais do Assistente Jack.'
                const failureResult = await client.sendButtons({
                  to: message.from,
                  body: failureText,
                  buttons: [
                    { id: 'tenant_appointments', title: 'Tentar novamente' },
                    { id: 'main_menu', title: 'Menu do Jack' },
                  ],
                })
                await recordAutomatedReply(
                  effectiveThreadId,
                  effectiveScope,
                  failureText,
                  failureResult.messages?.[0]?.id ?? null,
                  { source: 'n8n_module_failure', target_webhook_path: routerResponse.target_webhook_path }
                )
                repliesSent += 1
              } catch (moduleFailureReplyError) {
                repliesFailed += 1
                console.error('WhatsApp module failure reply send failed.', moduleFailureReplyError)
              }
            }
          }
        }
      } else {
        failed += 1
        console.error('WhatsApp inbound n8n forward failed.', {
          status: response.status,
          messageId: message.messageId,
        })
      }
    } catch (error) {
      failed += 1
      console.error('WhatsApp inbound n8n forward errored.', {
        messageId: message.messageId,
        error,
      })
    }
  }

  return { attempted: true, sent, failed, repliesSent, repliesFailed, modulesDispatched, moduleFailures, automationSuppressed }
}

export async function GET(request: Request) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()

  if (!verifyToken) {
    return jsonResponse('WhatsApp webhook verify token is not configured.', 503)
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    })
  }

  return jsonResponse('Invalid WhatsApp webhook verification token.', 403)
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim()

  if (!appSecret) {
    return jsonResponse('WhatsApp app secret is not configured.', 503)
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    console.error('Invalid WhatsApp webhook signature.', {
      hasSignature: Boolean(signature),
      rawBodyLength: rawBody.length,
    })

    return jsonResponse('Invalid WhatsApp webhook signature.', 401)
  }

  let payload: unknown

  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return jsonResponse('Invalid WhatsApp webhook payload.', 400)
  }

  const events = normalizeWhatsAppWebhookPayload(payload)
  const inbox = await recordMessagesInInbox(events.messages)
  const forward = await forwardMessagesToN8n(events.messages, inbox.routes)

  console.info('WhatsApp webhook received.', {
    messages: events.messages.length,
    statuses: events.statuses.length,
    inboxRecorded: inbox.recorded,
    inboxFailures: inbox.failed,
    inboxUnrouted: inbox.unrouted,
    forwarded: forward.sent,
    forwardFailures: forward.failed,
    routerRepliesSent: forward.repliesSent,
    routerReplyFailures: forward.repliesFailed,
    modulesDispatched: forward.modulesDispatched,
    moduleFailures: forward.moduleFailures,
    automationSuppressed: forward.automationSuppressed ?? 0,
  })

  return Response.json({
    ok: true,
    messages: events.messages.length,
    statuses: events.statuses.length,
    inbox_recorded: inbox.recorded,
    inbox_failed: inbox.failed,
    inbox_unrouted: inbox.unrouted,
    forwarded: forward.sent,
    forward_failed: forward.failed,
    router_replies_sent: forward.repliesSent,
    router_reply_failed: forward.repliesFailed,
    modules_dispatched: forward.modulesDispatched,
    module_failed: forward.moduleFailures,
    automation_suppressed: forward.automationSuppressed ?? 0,
  })
}
