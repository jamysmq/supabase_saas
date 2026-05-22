import { createTenantAdminClient } from '../../../../src/lib/tenant-admin'
import {
  type WhatsAppWebhookMessageEvent,
  normalizeWhatsAppWebhookPayload,
  verifyMetaWebhookSignature,
} from '../../../../src/lib/whatsapp-webhook'

function jsonResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

async function recordMessagesInInbox(messages: WhatsAppWebhookMessageEvent[]) {
  if (messages.length === 0) {
    return { attempted: false, recorded: 0, failed: 0 }
  }

  let supabase

  try {
    supabase = createTenantAdminClient()
  } catch (error) {
    console.error('WhatsApp inbox recording skipped: Supabase admin client is not configured.', error)
    return { attempted: false, recorded: 0, failed: messages.length }
  }

  let recorded = 0
  let failed = 0

  for (const message of messages) {
    if (message.type !== 'text' || !message.text) continue

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
    }
  }

  return { attempted: true, recorded, failed }
}

async function forwardMessagesToN8n(messages: WhatsAppWebhookMessageEvent[]) {
  const webhookUrl = process.env.WHATSAPP_INBOUND_N8N_WEBHOOK_URL?.trim()

  if (!webhookUrl || messages.length === 0) {
    return { attempted: false, sent: 0, failed: 0 }
  }

  const token = process.env.WHATSAPP_INBOUND_N8N_TOKEN?.trim()
  let sent = 0
  let failed = 0

  for (const message of messages) {
    if (message.type !== 'text' || !message.text) continue

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
          text: message.text,
          message: message.text,
          timestamp: message.timestamp,
          raw_event: message,
        }),
      })

      if (response.ok) {
        sent += 1
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

  return { attempted: true, sent, failed }
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
  const forward = await forwardMessagesToN8n(events.messages)

  console.info('WhatsApp webhook received.', {
    messages: events.messages.length,
    statuses: events.statuses.length,
    inboxRecorded: inbox.recorded,
    inboxFailures: inbox.failed,
    forwarded: forward.sent,
    forwardFailures: forward.failed,
  })

  return Response.json({
    ok: true,
    messages: events.messages.length,
    statuses: events.statuses.length,
    inbox_recorded: inbox.recorded,
    inbox_failed: inbox.failed,
    forwarded: forward.sent,
    forward_failed: forward.failed,
  })
}
