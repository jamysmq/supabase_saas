import { requireTenantUser } from '../../../../../src/lib/tenant-admin'

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

export async function PATCH(request: Request, context: RouteParams) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const { threadId } = await context.params
  const body = await request.json().catch(() => null)
  const status = String(body?.status ?? '').trim()

  if (!['open', 'closed'].includes(status)) {
    return errorResponse('Status invalido.')
  }

  const updates = {
    status,
    ...(status === 'closed' ? { unread_count: 0 } : {}),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await result.supabase
    .from('tenant_whatsapp_threads')
    .update(updates)
    .eq('id', threadId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id, customer_phone_e164, customer_name_snapshot, status, last_message_preview, last_message_at, last_inbound_at, last_outbound_at, unread_count, updated_at')
    .single()

  if (error) {
    return errorResponse('Nao foi possivel atualizar a conversa.', 500, error.message)
  }

  return Response.json({ thread: data })
}
