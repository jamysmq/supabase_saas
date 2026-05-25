import { requireTenantUser } from '../../../../src/lib/tenant-admin'

type EntryLinkRow = {
  tenant_id: string
  code: string
}

type TenantInfo = {
  legal_name?: string | null
  business_type?: string | null
}

function onlyDigits(value: string | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function buildWaMeUrl(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

function buildPrefilledText(tenant: TenantInfo | null, code: string) {
  const businessName = tenant?.legal_name?.trim() || 'o negócio'
  const ticket = `Atendimento ${code}`

  if (tenant?.business_type === 'salon') {
    return `Olá, Assistente Jack. Gostaria de atendimento do ${businessName}. ${ticket}`
  }

  if (tenant?.business_type === 'clinic') {
    return `Olá, Assistente Jack. Gostaria de atendimento da ${businessName}. ${ticket}`
  }

  if (tenant?.business_type === 'teacher') {
    return `Olá, Assistente Jack. Gostaria de atendimento do ${businessName}. ${ticket}`
  }

  if (tenant?.business_type === 'restaurant') {
    return `Olá, Assistente Jack. Gostaria de atendimento do ${businessName}. ${ticket}`
  }

  return `Olá, Assistente Jack. Gostaria de atendimento do ${businessName}. ${ticket}`
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
  const prefilledText = buildPrefilledText(result.tenant as TenantInfo, entryLink.code)

  return Response.json({
    code: entryLink.code,
    prefilled_text: prefilledText,
    whatsapp_url: platformPhone ? buildWaMeUrl(platformPhone, prefilledText) : null,
    platform_phone_configured: Boolean(platformPhone),
  })
}
