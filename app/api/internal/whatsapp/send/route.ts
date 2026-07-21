import {
  WhatsAppCloudConfigError,
  WhatsAppCloudSendError,
  WhatsAppCloudValidationError,
  createWhatsAppCloudClient,
  getWhatsAppCloudConfigFromEnv,
} from '../../../../../src/lib/whatsapp-cloud'

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return bearer || request.headers.get('x-internal-token')?.trim() || ''
}

function isAuthorized(request: Request) {
  const expectedToken = process.env.WHATSAPP_INTERNAL_SEND_TOKEN?.trim()

  if (!expectedToken) {
    return false
  }

  return getBearerToken(request) === expectedToken
}

function parsePreviewUrl(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return errorResponse('Unauthorized', 401)
  }

  const body = await request.json().catch(() => null)

  try {
    const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
    const messageType = String(body?.type ?? 'text').trim().toLowerCase()
    const result = messageType === 'template'
      ? await client.sendTemplate({
        to: String(body?.to ?? ''),
        name: String(body?.template_name ?? ''),
        languageCode: String(body?.template_language ?? 'pt_BR'),
        bodyParameters: parseStringArray(body?.template_body_parameters),
        quickReplyPayloads: parseStringArray(body?.template_button_payloads),
        urlButtonParameters: parseStringArray(body?.template_url_button_parameters),
      })
      : messageType === 'buttons'
      ? await client.sendButtons({
        to: String(body?.to ?? ''),
        body: String(body?.body ?? ''),
        buttons: Array.isArray(body?.buttons) ? body.buttons : [],
      })
      : messageType === 'list'
        ? await client.sendList({
          to: String(body?.to ?? ''),
          body: String(body?.body ?? ''),
          buttonText: String(body?.button_text ?? 'Opcoes'),
          sections: Array.isArray(body?.sections) ? body.sections : [],
        })
        : await client.sendText({
          to: String(body?.to ?? ''),
          body: String(body?.body ?? ''),
          previewUrl: parsePreviewUrl(body?.preview_url),
        })

    return Response.json({
      ok: true,
      provider: 'whatsapp_cloud',
      message_id: result.messages?.[0]?.id ?? null,
      wa_id: result.contacts?.[0]?.wa_id ?? null,
    })
  } catch (error) {
    if (error instanceof WhatsAppCloudConfigError) {
      return errorResponse('WhatsApp Cloud API nao esta configurada.', 503)
    }

    if (error instanceof WhatsAppCloudValidationError) {
      return errorResponse(error.message, 400)
    }

    if (error instanceof WhatsAppCloudSendError) {
      console.error('WhatsApp Cloud API send failed.', {
        status: error.status,
        providerCode: error.providerCode,
        providerMessage: error.providerMessage,
      })

      return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 502)
    }

    console.error('Unexpected WhatsApp send error.', error)
    return errorResponse('Nao foi possivel enviar a mensagem pelo WhatsApp.', 500)
  }
}
