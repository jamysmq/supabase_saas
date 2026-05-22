import { requireTenantUser } from '../../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'open'
  const normalizedStatus = status === 'closed' ? 'closed' : 'open'

  const { data, error } = await result.supabase
    .from('tenant_whatsapp_threads')
    .select('id, customer_phone_e164, customer_name_snapshot, status, last_message_preview, last_message_at, last_inbound_at, last_outbound_at, unread_count, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('status', normalizedStatus)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) {
    return errorResponse('Nao foi possivel carregar as conversas.', 500, error.message)
  }

  return Response.json({ threads: data ?? [] })
}
