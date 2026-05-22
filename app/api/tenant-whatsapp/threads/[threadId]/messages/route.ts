import {
  WhatsAppCloudConfigError,
  WhatsAppCloudSendError,
  WhatsAppCloudValidationError,
  createWhatsAppCloudClient,
  getWhatsAppCloudConfigFromEnv,
} from '../../../../../../src/lib/whatsapp-cloud'
import { requireTenantUser } from '../../../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

type RouteParams = {
  params: Promise<{
    threadId: string
  }>
}

export async function GET(request: Request, context: RouteParams) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { threadId } = await context.params

  const { data: thread, error: threadError } = await result.supabase
    .from('tenant_whatsapp_threads')
    .select('id')
    .eq('id', threadId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .single()

  if (threadError || !thread) {
    return errorResponse('Conversa nao encontrada.', 404, threadError?.message)
  }

  const { data, error } = await result.supabase
    .from('tenant_whatsapp_messages')
    .select('id, direction, sender_type, sender_tenant_user_id, provider_message_id, status, body, created_at')
    .eq('thread_id', threadId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) {
    return errorResponse('Nao foi possivel carregar as mensagens.', 500, error.message)
  }

  await result.supabase
    .from('tenant_whatsapp_threads')
    .update({ unread_count: 0, updated_at: new Date().toISOString() })
    .eq('id', threadId)
    .eq('tenant_id', result.tenantUser.tenant_id)

  return Response.json({ messages: data ?? [] })
}

export async function POST(request: Request, context: RouteParams) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { threadId } = await context.params
  const body = await request.json().catch(() => null)
  const messageBody = String(body?.body ?? '').trim()

  if (!messageBody || messageBody.length > 4096) {
    return errorResponse('Informe uma mensagem com ate 4096 caracteres.')
  }

  const { data: thread, error: threadError } = await result.supabase
    .from('tenant_whatsapp_threads')
    .select('id, tenant_id, customer_phone_e164')
    .eq('id', threadId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .single()

  if (threadError || !thread) {
    return errorResponse('Conversa nao encontrada.', 404, threadError?.message)
  }

  try {
    const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
    const sendResult = await client.sendText({
      to: thread.customer_phone_e164,
      body: messageBody,
      previewUrl: false,
    })
    const providerMessageId = sendResult.messages?.[0]?.id ?? null
    const now = new Date().toISOString()

    const { data: inserted, error: insertError } = await result.supabase
      .from('tenant_whatsapp_messages')
      .insert({
        thread_id: thread.id,
        tenant_id: result.tenantUser.tenant_id,
        direction: 'outbound',
        sender_type: 'tenant_user',
        sender_tenant_user_id: result.tenantUser.id,
        provider: 'whatsapp_cloud',
        provider_message_id: providerMessageId,
        status: 'sent',
        body: messageBody,
        raw_payload: sendResult,
        created_at: now,
      })
      .select('id, direction, sender_type, sender_tenant_user_id, provider_message_id, status, body, created_at')
      .single()

    if (insertError) {
      return errorResponse('Mensagem enviada, mas nao foi possivel registrar no historico.', 500, insertError.message)
    }

    await result.supabase
      .from('tenant_whatsapp_threads')
      .update({
        status: 'open',
        last_message_preview: messageBody.slice(0, 240),
        last_message_at: now,
        last_outbound_at: now,
        unread_count: 0,
        updated_at: now,
      })
      .eq('id', thread.id)
      .eq('tenant_id', result.tenantUser.tenant_id)

    return Response.json({ message: inserted })
  } catch (error) {
    if (error instanceof WhatsAppCloudConfigError) {
      return errorResponse('WhatsApp Cloud API nao esta configurada.', 503)
    }

    if (error instanceof WhatsAppCloudValidationError) {
      return errorResponse(error.message, 400)
    }

    if (error instanceof WhatsAppCloudSendError) {
      console.error('Tenant WhatsApp send failed.', {
        status: error.status,
        providerCode: error.providerCode,
        providerMessage: error.providerMessage,
      })

      return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 502)
    }

    console.error('Unexpected tenant WhatsApp send error.', error)
    return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 500)
  }
}
