import { requireTenantUser } from '../../../../src/lib/tenant-admin'

type EntryLinkRow = {
  tenant_id: string
  code: string
}

function onlyDigits(value: string | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function buildWaMeUrl(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if ('error' in result) {
    return result.error
  }

  const { data, error } = await result.supabase
    .rpc('admin_ensure_tenant_whatsapp_entry_link', {
      p_tenant_id: result.tenantUser.tenant_id,
    })
    .single()

  const entryLink = data as EntryLinkRow | null

  if (error || !entryLink) {
    console.error('Could not ensure tenant WhatsApp entry link.', error?.message)
    return Response.json(
      { error: 'Could not load WhatsApp entry link.' },
      { status: 500 }
    )
  }

  const platformPhone = onlyDigits(process.env.WHATSAPP_PUBLIC_PHONE_E164)
  const prefilledText = `Olá, Assistente Jack! Quero atendimento. Código: ${entryLink.code}`

  return Response.json({
    code: entryLink.code,
    prefilled_text: prefilledText,
    whatsapp_url: platformPhone ? buildWaMeUrl(platformPhone, prefilledText) : null,
    platform_phone_configured: Boolean(platformPhone),
  })
}
