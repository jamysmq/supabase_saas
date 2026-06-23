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

export type SendWhatsAppButtonInput = {
  to: string
  body: string
  buttons: Array<{
    id: string
    title: string
  }>
}

export type SendWhatsAppListInput = {
  to: string
  body: string
  buttonText: string
  sections: Array<{
    title?: string
    rows: Array<{
      id: string
      title: string
      description?: string
    }>
  }>
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

function validateInteractiveText(value: string, label: string, maxLength: number) {
  const text = String(value ?? '').trim()

  if (!text || text.length > maxLength) {
    throw new WhatsAppCloudValidationError(`Invalid WhatsApp ${label}.`)
  }

  return text
}

function validateInteractiveId(value: string) {
  const id = String(value ?? '').trim()

  if (!id || id.length > 256) {
    throw new WhatsAppCloudValidationError('Invalid WhatsApp interactive id.')
  }

  return id
}

export function buildWhatsAppCloudButtonPayload(input: SendWhatsAppButtonInput) {
  const to = normalizeWhatsAppRecipient(input.to)
  const body = validateInteractiveText(input.body, 'button body', 1024)
  const buttons = Array.isArray(input.buttons) ? input.buttons : []

  if (to.length < 8 || to.length > 15) {
    throw new WhatsAppCloudValidationError('Invalid WhatsApp recipient.')
  }

  if (buttons.length < 1 || buttons.length > 3) {
    throw new WhatsAppCloudValidationError('WhatsApp button messages require 1 to 3 buttons.')
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((button) => ({
          type: 'reply',
          reply: {
            id: validateInteractiveId(button.id),
            title: validateInteractiveText(button.title, 'button title', 20),
          },
        })),
      },
    },
  }
}

export function buildWhatsAppCloudListPayload(input: SendWhatsAppListInput) {
  const to = normalizeWhatsAppRecipient(input.to)
  const body = validateInteractiveText(input.body, 'list body', 1024)
  const buttonText = validateInteractiveText(input.buttonText, 'list button text', 20)
  const sections = Array.isArray(input.sections) ? input.sections : []

  if (to.length < 8 || to.length > 15) {
    throw new WhatsAppCloudValidationError('Invalid WhatsApp recipient.')
  }

  if (sections.length < 1 || sections.length > 10) {
    throw new WhatsAppCloudValidationError('WhatsApp list messages require 1 to 10 sections.')
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: buttonText,
        sections: sections.map((section) => ({
          ...(section.title ? { title: validateInteractiveText(section.title, 'list section title', 24) } : {}),
          rows: (() => {
            const rows = Array.isArray(section.rows) ? section.rows : []

            if (rows.length < 1 || rows.length > 10) {
              throw new WhatsAppCloudValidationError('WhatsApp list sections require 1 to 10 rows.')
            }

            return rows.map((row) => ({
              id: validateInteractiveId(row.id),
              title: validateInteractiveText(row.title, 'list row title', 24),
              ...(row.description ? { description: validateInteractiveText(row.description, 'list row description', 72) } : {}),
            }))
          })(),
        })),
      },
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

  async function sendPayload(payload: unknown) {
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
  }

  return {
    async sendText(input: SendWhatsAppTextInput): Promise<WhatsAppCloudSendResponse> {
      const payload = buildWhatsAppCloudTextPayload(input)
      return sendPayload(payload)
    },
    async sendButtons(input: SendWhatsAppButtonInput): Promise<WhatsAppCloudSendResponse> {
      const payload = buildWhatsAppCloudButtonPayload(input)
      return sendPayload(payload)
    },
    async sendList(input: SendWhatsAppListInput): Promise<WhatsAppCloudSendResponse> {
      const payload = buildWhatsAppCloudListPayload(input)
      return sendPayload(payload)
    },
  }
}
