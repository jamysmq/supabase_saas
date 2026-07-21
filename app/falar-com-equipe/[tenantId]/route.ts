import { createTenantAdminClient } from '../../../src/lib/tenant-admin'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function notFoundResponse() {
  return new Response('Contato não encontrado.', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params
  if (!uuidPattern.test(tenantId)) return notFoundResponse()

  const supabase = createTenantAdminClient()
  const { data, error } = await supabase
    .from('tenants')
    .select('legal_name, public_name, whatsapp_e164')
    .eq('id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  if (error || !data) return notFoundResponse()

  const tenantPhone = String(data.whatsapp_e164 ?? '').replace(/\D/g, '')
  const jackPhone = String(process.env.WHATSAPP_PUBLIC_PHONE_E164 ?? '').replace(/\D/g, '')
  if (tenantPhone.length < 10 || tenantPhone.length > 15 || tenantPhone === jackPhone) {
    return notFoundResponse()
  }

  const tenantName = String(data.public_name || data.legal_name || 'sua equipe')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  const greeting = `Olá! Recebi uma cobrança pelo Assistente Jack e gostaria de falar com a equipe de ${tenantName}.`
  const destination = `https://wa.me/${tenantPhone}?text=${encodeURIComponent(greeting)}`

  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
