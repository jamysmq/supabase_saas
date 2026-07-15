import { requireTenantUser } from '../../../src/lib/tenant-admin'

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (result.tenantUser.role !== 'admin') {
    return errorResponse('Apenas o administrador pode alterar os dados do negócio.', 403)
  }

  const body = await request.json().catch(() => null)
  const legalName = String(body?.legal_name ?? '').replace(/\s+/g, ' ').trim()
  const publicName = String(body?.public_name ?? '').replace(/\s+/g, ' ').trim()
  const email = String(body?.email ?? '').trim().toLowerCase()
  const whatsapp = String(body?.whatsapp_e164 ?? '').replace(/\D/g, '')

  if (legalName.length < 3 || legalName.length > 160) {
    return errorResponse('Informe o nome completo ou razão social.')
  }

  if (publicName.length < 2 || publicName.length > 80) {
    return errorResponse('Informe um nome fantasia entre 2 e 80 caracteres.')
  }

  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse('Informe um e-mail de contato válido.')
  }

  if (whatsapp.length < 10 || whatsapp.length > 15) {
    return errorResponse('Informe um WhatsApp válido, com DDI e DDD.')
  }

  const { error } = await result.supabase
    .from('tenants')
    .update({
      legal_name: legalName,
      public_name: publicName,
      email,
      whatsapp_e164: whatsapp,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.tenantUser.tenant_id)

  if (error) {
    return errorResponse('Não foi possível atualizar os dados do negócio.', 500)
  }

  return Response.json({ ok: true })
}
