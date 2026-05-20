import {
  normalizeWhatsAppWebhookPayload,
  verifyMetaWebhookSignature,
} from '../../../../src/lib/whatsapp-webhook'

function jsonResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim()

  if (!verifyToken) {
    return jsonResponse('WhatsApp webhook verify token is not configured.', 503)
  }

  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new Response(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    })
  }

  return jsonResponse('Invalid WhatsApp webhook verification token.', 403)
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim()

  if (!appSecret) {
    return jsonResponse('WhatsApp app secret is not configured.', 503)
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    return jsonResponse('Invalid WhatsApp webhook signature.', 401)
  }

  let payload: unknown

  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return jsonResponse('Invalid WhatsApp webhook payload.', 400)
  }

  const events = normalizeWhatsAppWebhookPayload(payload)

  console.info('WhatsApp webhook received.', {
    messages: events.messages.length,
    statuses: events.statuses.length,
  })

  return Response.json({
    ok: true,
    messages: events.messages.length,
    statuses: events.statuses.length,
  })
}

