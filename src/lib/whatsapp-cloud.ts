type FetchLike = typeof fetch

export type WhatsAppCloudConfig = {
  accessToken: string
  phoneNumberId: string
  graphApiVersion?: string
}

export type SendWhatsAppTextInput = {
  to: string
  body: string
  previewUrl?: boolean
}

export type WhatsAppCloudSendResponse = {
  messaging_product?: string
  contacts?: Array<{
    input?: string
    wa_id?: string
  }>
  messages?: Array<{
    id?: string
    message_status?: string
  }>
}

export class WhatsAppCloudConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppCloudConfigError'
  }
}

export class WhatsAppCloudValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppCloudValidationError'
  }
}

export class WhatsAppCloudSendError extends Error {
  status: number
  providerCode?: string
  providerMessage?: string

  constructor(message: string, status: number, providerCode?: string, providerMessage?: string) {
    super(message)
    this.name = 'WhatsAppCloudSendError'
    this.status = status
    this.providerCode = providerCode
    this.providerMessage = providerMessage
  }
}

export function normalizeWhatsAppRecipient(value: string) {
  return String(value ?? '').replace(/\D/g, '')
}

export function buildWhatsAppCloudTextPayload(input: SendWhatsAppTextInput) {
  const to = normalizeWhatsAppRecipient(input.to)
  const body = String(input.body ?? '').trim()

  if (to.length < 8 || to.length > 15) {
    throw new WhatsAppCloudValidationError('Invalid WhatsApp recipient.')
  }

  if (!body || body.length > 4096) {
    throw new WhatsAppCloudValidationError('Invalid WhatsApp message body.')
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: input.previewUrl ?? false,
      body,
    },
  }
}

export function getWhatsAppCloudConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppCloudConfig {
  const accessToken = env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim()
  const phoneNumberId = env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim()
  const graphApiVersion = env.WHATSAPP_CLOUD_GRAPH_VERSION?.trim() || 'v23.0'

  if (!accessToken) {
    throw new WhatsAppCloudConfigError('WHATSAPP_CLOUD_ACCESS_TOKEN is not configured.')
  }

  if (!phoneNumberId) {
    throw new WhatsAppCloudConfigError('WHATSAPP_CLOUD_PHONE_NUMBER_ID is not configured.')
  }

  return {
    accessToken,
    phoneNumberId,
    graphApiVersion,
  }
}

export function createWhatsAppCloudClient(config: WhatsAppCloudConfig, fetchImpl: FetchLike = fetch) {
  const graphApiVersion = config.graphApiVersion?.trim() || 'v23.0'
  const baseUrl = `https://graph.facebook.com/${encodeURIComponent(graphApiVersion)}/${encodeURIComponent(config.phoneNumberId)}`

  return {
    async sendText(input: SendWhatsAppTextInput): Promise<WhatsAppCloudSendResponse> {
      const payload = buildWhatsAppCloudTextPayload(input)
      const response = await fetchImpl(`${baseUrl}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const responseText = await response.text()
      let responseBody: unknown = null

      try {
        responseBody = responseText ? JSON.parse(responseText) : null
      } catch {
        responseBody = responseText
      }

      if (!response.ok) {
        const errorBody = typeof responseBody === 'object' && responseBody !== null && 'error' in responseBody
          ? (responseBody as { error?: { code?: string | number; message?: string } }).error
          : null

        throw new WhatsAppCloudSendError(
          'WhatsApp Cloud API send failed.',
          response.status,
          errorBody?.code === undefined ? undefined : String(errorBody.code),
          errorBody?.message
        )
      }

      return (responseBody ?? {}) as WhatsAppCloudSendResponse
    },
  }
}
