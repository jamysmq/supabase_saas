import { requireTenantUser } from '../../../../src/lib/tenant-admin'

type EntryLinkRow = {
  tenant_id: string
  code: string
}

type TenantInfo = {
  legal_name?: string | null
  public_name?: string | null
  business_type?: string | null
}

function onlyDigits(value: string | undefined) {
  return String(value ?? '').replace(/\D/g, '')
}

function buildWaMeUrl(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

function buildPrefilledText(tenant: TenantInfo | null, code: string) {
  const businessName = tenant?.public_name?.trim() || tenant?.legal_name?.trim() || 'este estabelecimento'
  return `Olá! Quero iniciar um atendimento com ${businessName} pelo Assistente Jack. Meu código de acesso é ${code}.`
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
    console.error('Não foi possível gerar o link de atendimento do tenant.', error?.message)
    return Response.json(
      { error: 'Não foi possível carregar o link de atendimento.' },
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
