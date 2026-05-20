import { createHmac, timingSafeEqual } from 'crypto'

export type WhatsAppWebhookMessageEvent = {
  phoneNumberId: string | null
  from: string
  messageId: string
  timestamp: string | null
  type: string
  text: string | null
}

export type WhatsAppWebhookStatusEvent = {
  phoneNumberId: string | null
  recipientId: string | null
  messageId: string
  status: string
  timestamp: string | null
}

type WhatsAppWebhookChangeValue = {
  metadata?: {
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
  }>
  statuses?: Array<{
    id?: string
    recipient_id?: string
    status?: string
    timestamp?: string
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

      for (const message of value?.messages ?? []) {
        if (!message.from || !message.id) continue

        messages.push({
          phoneNumberId,
          from: message.from,
          messageId: message.id,
          timestamp: message.timestamp ?? null,
          type: message.type ?? 'unknown',
          text: message.type === 'text' ? message.text?.body ?? null : null,
        })
      }

      for (const status of value?.statuses ?? []) {
        if (!status.id || !status.status) continue

        statuses.push({
          phoneNumberId,
          recipientId: status.recipient_id ?? null,
          messageId: status.id,
          status: status.status,
          timestamp: status.timestamp ?? null,
        })
      }
    }
  }

  return { messages, statuses }
}

