import { createSupabaseAdminClient } from '../../../../src/lib/platform-admin'

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

export async function POST(request: Request) {
  const supabase = createSupabaseAdminClient()
  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados invalidos. Recarregue a pagina e tente novamente.')
  }

  const name = String(body.name || '').trim().replace(/\s+/g, ' ')
  const email = String(body.email || '').trim().toLowerCase()
  const whatsapp = String(body.whatsapp_e164 || body.whatsapp || '').trim()
  const whatsappDigits = onlyDigits(whatsapp)
  const subject = String(body.subject || '').trim()
  const message = String(body.message || body.body || '').trim()

  if (name.length < 2 || name.length > 120) {
    return errorResponse('Informe seu nome.')
  }

  if (!email || !isValidEmail(email)) {
    return errorResponse('Informe um e-mail valido.')
  }

  if (whatsappDigits && (whatsappDigits.length < 10 || whatsappDigits.length > 13)) {
    return errorResponse('Informe um WhatsApp valido ou deixe o campo em branco.')
  }

  if (subject.length > 120) {
    return errorResponse('O assunto deve ter no maximo 120 caracteres.')
  }

  if (message.length < 10 || message.length > 2000) {
    return errorResponse('Escreva uma mensagem entre 10 e 2000 caracteres.')
  }

  const { data: admin } = await supabase
    .from('platform_admins')
    .select('auth_user_id')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  const { data, error } = await supabase
    .from('platform_contact_messages')
    .insert({
      recipient_admin_auth_user_id: admin?.auth_user_id ?? null,
      name,
      email,
      whatsapp_e164: whatsappDigits || null,
      subject: subject || null,
      body: message,
      source: 'public_home_contact',
      raw_payload: {
        name,
        email,
        whatsapp_e164: whatsappDigits || null,
        subject: subject || null,
        submitted_at: new Date().toISOString(),
      },
    })
    .select('id')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel enviar a mensagem.', 500)
  }

  return Response.json({ ok: true, id: data.id })
}
