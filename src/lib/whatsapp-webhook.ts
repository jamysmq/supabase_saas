import { createHmac, timingSafeEqual } from 'crypto'

export type WhatsAppWebhookMessageEvent = {
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  from: string
  messageId: string
  timestamp: string | null
  type: string
  text: string | null
  interactiveReplyId: string | null
}

export type WhatsAppWebhookStatusEvent = {
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  recipientId: string | null
  messageId: string
  status: string
  timestamp: string | null
  errors: Array<{
    code: number | null
    title: string | null
    message: string | null
    details: string | null
  }>
}

type WhatsAppWebhookChangeValue = {
  metadata?: {
    display_phone_number?: string
    phone_number_id?: string
  }
  messages?: Array<{
    from?: string
    id?: string
    timestamp?: string
    type?: string
    text?: {
      body?: string
    }
    interactive?: {
      type?: string
      button_reply?: { id?: string; title?: string }
      list_reply?: { id?: string; title?: string; description?: string }
    }
    button?: {
      payload?: string
      text?: string
    }
  }>
  statuses?: Array<{
    id?: string
    recipient_id?: string
    status?: string
    timestamp?: string
    errors?: Array<{
      code?: number
      title?: string
      message?: string
      error_data?: { details?: string }
    }>
  }>
}

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: WhatsAppWebhookChangeValue
    }>
  }>
}

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string) {
  const signature = signatureHeader?.trim() ?? ''
  const prefix = 'sha256='

  if (!signature.startsWith(prefix)) return false

  const receivedHex = signature.slice(prefix.length)
  const expectedHex = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex')

  const received = Buffer.from(receivedHex, 'hex')
  const expected = Buffer.from(expectedHex, 'hex')

  if (received.length !== expected.length) return false

  return timingSafeEqual(received, expected)
}

export function normalizeWhatsAppWebhookPayload(payload: unknown) {
  const body = payload as WhatsAppWebhookPayload
  const messages: WhatsAppWebhookMessageEvent[] = []
  const statuses: WhatsAppWebhookStatusEvent[] = []

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const phoneNumberId = value?.metadata?.phone_number_id ?? null
      const displayPhoneNumber = value?.metadata?.display_phone_number ?? null

      for (const message of value?.messages ?? []) {
        if (!message.from || !message.id) continue

        const interactiveReply = message.interactive?.button_reply ?? message.interactive?.list_reply
        const interactiveReplyId = interactiveReply?.id ?? message.button?.payload ?? null
        const interactiveTextById: Record<string, string> = {
          platform_about: 'Conhecer os planos',
          platform_signup: 'Quero me cadastrar',
          tenant_search: 'Procurar serviço ou produto de um cliente',
          human_handoff: 'Atendimento humano',
          main_menu: 'menu principal',
          tenant_appointments: 'Agendamento',
          tenant_billing: 'Cadastro ou mensalidades',
          tenant_handoff: 'Atendimento humano',
          appointment_schedule: '1',
          appointment_reschedule: '2',
          appointment_cancel: '3',
          appointment_confirm_yes: 'sim',
          appointment_restart: '0',
          appointment_more: 'mais',
          tenant_confirm_yes: 'Sim',
          tenant_confirm_no: 'Não',
        }
        const interactiveText = interactiveReplyId
          ? interactiveTextById[interactiveReplyId]
            ?? (interactiveReplyId.startsWith('tenant_choice_') ? interactiveReplyId.slice('tenant_choice_'.length) : null)
            ?? (interactiveReplyId.startsWith('appointment_choice_') ? interactiveReplyId.slice('appointment_choice_'.length) : null)
            ?? (interactiveReplyId.startsWith('billing_signup_choice_') ? interactiveReplyId.slice('billing_signup_choice_'.length) : null)
            ?? interactiveReply?.title ?? message.button?.text ?? interactiveReplyId
          : null

        messages.push({
          phoneNumberId,
          displayPhoneNumber,
          from: message.from,
          messageId: message.id,
          timestamp: message.timestamp ?? null,
          type: message.type ?? 'unknown',
          text: message.type === 'text' ? message.text?.body ?? null : interactiveText,
          interactiveReplyId,
        })
      }

      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.status) continue

        statuses.push({
          phoneNumberId,
          displayPhoneNumber,
          recipientId: status.recipient_id ?? null,
          messageId: status.id,
          status: status.status,
          timestamp: status.timestamp ?? null,
          errors: (status.errors ?? []).map((error) => ({
            code: typeof error.code === 'number' ? error.code : null,
            title: error.title ?? null,
            message: error.message ?? null,
            details: error.error_data?.details ?? null,
          })),
        })
      }
    }
  }

  return { messages, statuses }
}
