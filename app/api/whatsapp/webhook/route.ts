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
}

type N8nRouterResponse = {
  reply_text?: unknown
  dispatch_to_module?: unknown
  target_webhook_path?: unknown
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
      routes.push({
        messageId: message.messageId,
        threadId: String(data),
      })
    } else {
      unrouted += 1
      console.warn('WhatsApp inbound message was not routed to a tenant.', {
        messageId: message.messageId,
        phoneNumberId: message.phoneNumberId,
        fromSuffix: message.from.slice(-4),
      })
    }
  }

  return { attempted: true, recorded, failed, unrouted, routes }
}

async function recordAutomatedReply(threadId: string | null, body: string, providerMessageId: string | null, rawPayload: unknown) {
  if (!threadId) return

  let supabase

  try {
    supabase = createTenantAdminClient()
  } catch (error) {
    console.error('WhatsApp automated reply recording skipped: Supabase admin client is not configured.', error)
    return
  }

  const { data: thread, error: threadError } = await supabase
    .from('tenant_whatsapp_threads')
    .select('id, tenant_id')
    .eq('id', threadId)
    .single()

  if (threadError || !thread) {
    console.error('WhatsApp automated reply recording skipped: thread not found.', {
      threadId,
      error: threadError?.message,
    })
    return
  }

  const now = new Date().toISOString()
  const { error: insertError } = await supabase.from('tenant_whatsapp_messages').insert({
    thread_id: thread.id,
    tenant_id: thread.tenant_id,
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
    .from('tenant_whatsapp_threads')
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

  for (const message of messages) {
    if (message.type !== 'text' || !message.text) continue

    const route = routes.find((item) => item.messageId === message.messageId)

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
          inbox_routed: Boolean(route),
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

        const replyText = normalizeN8nReplyText(routerResponse?.reply_text)

        if (replyText) {
          try {
            const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
            const sendResult = await client.sendText({
              to: message.from,
              body: replyText,
              previewUrl: false,
            })
            const reply: N8nForwardReply = {
              messageId: message.messageId,
              threadId: route?.threadId ?? null,
              body: replyText,
              providerMessageId: sendResult.messages?.[0]?.id ?? null,
            }

            await recordAutomatedReply(reply.threadId, reply.body, reply.providerMessageId, {
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
                phone_number_id: message.phoneNumberId,
                tenant_phone_e164: message.displayPhoneNumber,
                to: message.displayPhoneNumber,
                from: message.from,
                customer_phone_e164: message.from,
                chat_id: message.from,
                message_id: message.messageId,
                inbox_thread_id: route?.threadId ?? null,
                inbox_routed: Boolean(route),
                text: message.text,
                message: message.text,
                timestamp: message.timestamp,
                raw_event: message,
              }),
            })

            if (moduleResponse.ok) {
              modulesDispatched += 1
            } else {
              moduleFailures += 1
              console.error('WhatsApp inbound n8n module dispatch failed.', {
                status: moduleResponse.status,
                messageId: message.messageId,
                targetWebhookPath: routerResponse.target_webhook_path,
              })
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

  return { attempted: true, sent, failed, repliesSent, repliesFailed, modulesDispatched, moduleFailures }
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
  })
}
