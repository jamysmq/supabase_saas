import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'active'

  let query = result.supabase
    .from('platform_contact_messages')
    .select('id, name, email, whatsapp_e164, subject, body, status, source, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(100)

  if (status === 'active') {
    query = query.in('status', ['new', 'read'])
  } else if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return errorResponse('Nao foi possivel listar as mensagens.', 500, error.message)
  }

  return Response.json({ messages: data ?? [] })
}

export async function PATCH(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '').trim()
  const status = String(body?.status || '').trim()

  if (!id) {
    return errorResponse('Mensagem invalida.')
  }

  if (!['new', 'read', 'archived'].includes(status)) {
    return errorResponse('Status invalido.')
  }

  const { error } = await result.supabase
    .from('platform_contact_messages')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    return errorResponse('Nao foi possivel atualizar a mensagem.', 500, error.message)
  }

  return Response.json({ ok: true })
}
