import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'
import {
  WhatsAppCloudConfigError,
  WhatsAppCloudSendError,
  WhatsAppCloudValidationError,
  createWhatsAppCloudClient,
  getWhatsAppCloudConfigFromEnv,
} from '../../../../src/lib/whatsapp-cloud'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error
  const url = new URL(request.url)
  const threadId = url.searchParams.get('thread_id')?.trim() || null
  const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '30', 10)
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 10), 50) : 30
  const before = url.searchParams.get('before')?.trim() || null

  if (threadId) {
    const { data: thread, error: threadError } = await result.supabase
      .from('platform_whatsapp_threads')
      .select('id')
      .eq('id', threadId)
      .single()

    if (threadError || !thread) return errorResponse('Conversa institucional nao encontrada.', 404)

    let messagesQuery = result.supabase
      .from('platform_whatsapp_messages')
      .select('id, thread_id, direction, sender_type, status, body, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(limit + 1)

    if (before) messagesQuery = messagesQuery.lt('created_at', before)

    const { data, error } = await messagesQuery
    if (error) return errorResponse('Nao foi possivel carregar as mensagens.', 500, error.message)

    const descendingMessages = data ?? []
    const hasMore = descendingMessages.length > limit
    const page = descendingMessages.slice(0, limit).reverse()

    await result.supabase
      .from('platform_whatsapp_threads')
      .update({ unread_count: 0, updated_at: new Date().toISOString() })
      .eq('id', threadId)

    return Response.json({
      messages: page,
      has_more: hasMore,
      next_before: page[0]?.created_at ?? null,
    })
  }

  const { data: threads, error } = await result.supabase.from('platform_whatsapp_threads').select('id, customer_phone_e164, status, last_message_preview, last_message_at, unread_count, created_at').order('last_message_at', { ascending: false }).limit(100)
  if (error) return Response.json({ error: 'Nao foi possivel listar as conversas.' }, { status: 500 })
  return Response.json({ threads: threads ?? [] })
}

export async function PATCH(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error
  const body = await request.json().catch(() => null)
  const id = String(body?.id || '').trim()
  const status = String(body?.status || '').trim()
  if (!id || !['open', 'archived'].includes(status)) return Response.json({ error: 'Dados invalidos.' }, { status: 400 })
  const { error } = await result.supabase.from('platform_whatsapp_threads').update({ status, unread_count: 0, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return Response.json({ error: 'Nao foi possivel atualizar a conversa.' }, { status: 500 })
  return Response.json({ ok: true })
}

export async function POST(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  const payload = await request.json().catch(() => null)
  const id = String(payload?.id ?? '').trim()
  const messageBody = String(payload?.body ?? '').trim()

  if (!id || !messageBody || messageBody.length > 4096) {
    return errorResponse('Informe uma mensagem com ate 4096 caracteres.')
  }

  const { data: thread, error: threadError } = await result.supabase
    .from('platform_whatsapp_threads')
    .select('id, customer_phone_e164')
    .eq('id', id)
    .single()

  if (threadError || !thread) {
    return errorResponse('Conversa institucional nao encontrada.', 404, threadError?.message)
  }

  try {
    const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
    const sendResult = await client.sendText({
      to: thread.customer_phone_e164,
      body: messageBody,
      previewUrl: false,
    })
    const now = new Date().toISOString()
    const providerMessageId = sendResult.messages?.[0]?.id ?? null

    const { data: inserted, error: insertError } = await result.supabase
      .from('platform_whatsapp_messages')
      .insert({
        thread_id: thread.id,
        direction: 'outbound',
        sender_type: 'admin',
        provider: 'whatsapp_cloud',
        provider_message_id: providerMessageId,
        status: 'sent',
        body: messageBody,
        raw_payload: sendResult,
        created_at: now,
      })
      .select('id, thread_id, direction, sender_type, status, body, created_at')
      .single()

    if (insertError) {
      return errorResponse('Mensagem enviada, mas nao foi possivel registrar no historico.', 500, insertError.message)
    }

    await result.supabase
      .from('platform_whatsapp_threads')
      .update({
        status: 'open',
        last_message_preview: messageBody.slice(0, 240),
        last_message_at: now,
        last_outbound_at: now,
        human_takeover_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        unread_count: 0,
        updated_at: now,
      })
      .eq('id', thread.id)

    return Response.json({ message: inserted })
  } catch (error) {
    if (error instanceof WhatsAppCloudConfigError) {
      return errorResponse('WhatsApp Cloud API nao esta configurada.', 503)
    }
    if (error instanceof WhatsAppCloudValidationError) {
      return errorResponse(error.message, 400)
    }
    if (error instanceof WhatsAppCloudSendError) {
      console.error('Platform WhatsApp send failed.', {
        status: error.status,
        providerCode: error.providerCode,
        providerMessage: error.providerMessage,
      })
      return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 502)
    }
    console.error('Unexpected platform WhatsApp send error.', error)
    return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 500)
  }
}
