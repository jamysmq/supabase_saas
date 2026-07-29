import 'server-only'

import type {
  CreateProviderChargeInput,
  NormalizedProviderCharge,
  ProviderChargeStatus,
  ProviderConnectionCredentials,
} from './provider-contract'

const MERCADO_PAGO_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments'

type MercadoPagoPaymentResponse = {
  id?: unknown
  status?: unknown
  status_detail?: unknown
  external_reference?: unknown
  transaction_amount?: unknown
  date_approved?: unknown
  date_of_expiration?: unknown
  transaction_details?: {
    net_received_amount?: unknown
  } | null
  fee_details?: Array<{ amount?: unknown }> | null
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: unknown
      qr_code_base64?: unknown
      ticket_url?: unknown
    } | null
  } | null
  [key: string]: unknown
}

export class MercadoPagoPaymentError extends Error {
  readonly status: number
  readonly code?: string

  constructor(
    message: string,
    status: number,
    code?: string
  ) {
    super(message)
    this.name = 'MercadoPagoPaymentError'
    this.status = status
    this.code = code
  }
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function amountToCents(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN

  if (!Number.isFinite(parsed)) return undefined
  return Math.round(parsed * 100)
}

function mapStatus(status: string): ProviderChargeStatus {
  if (status === 'approved') return 'paid'
  if (['pending', 'in_process', 'in_mediation', 'authorized'].includes(status)) {
    return 'pending'
  }
  if (status === 'rejected') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'refunded') return 'refunded'
  if (status === 'charged_back') return 'chargeback'
  if (status === 'expired') return 'expired'
  return 'pending'
}

function normalizePayment(
  payment: MercadoPagoPaymentResponse
): NormalizedProviderCharge & {
  providerStatus: string
  providerStatusDetail: string
  qrCodeBase64?: string
} {
  const providerChargeId = String(payment.id ?? '').trim()
  const externalReference = asString(payment.external_reference).trim()
  const providerStatus = asString(payment.status).trim()
  const transactionData = payment.point_of_interaction?.transaction_data

  if (!providerChargeId || !externalReference || !providerStatus) {
    throw new MercadoPagoPaymentError(
      'O Mercado Pago retornou um pagamento incompleto.',
      502,
      'invalid_provider_response'
    )
  }

  const feeCents = (payment.fee_details ?? []).reduce((total, fee) => {
    return total + (amountToCents(fee.amount) ?? 0)
  }, 0)

  return {
    provider: 'mercado_pago',
    providerChargeId,
    externalReference,
    paymentMethod: 'pix',
    status: mapStatus(providerStatus),
    amountCents: amountToCents(payment.transaction_amount) ?? 0,
    feeCents,
    netAmountCents: amountToCents(
      payment.transaction_details?.net_received_amount
    ),
    checkoutUrl: asString(transactionData?.ticket_url) || undefined,
    pixCopyPaste: asString(transactionData?.qr_code) || undefined,
    pixExpiresAt: asString(payment.date_of_expiration) || undefined,
    paidAt: asString(payment.date_approved) || undefined,
    providerPayload: payment,
    providerStatus,
    providerStatusDetail: asString(payment.status_detail),
    qrCodeBase64: asString(transactionData?.qr_code_base64) || undefined,
  }
}

async function parseResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | MercadoPagoPaymentResponse
    | { message?: unknown; error?: unknown }
    | null

  if (!response.ok || !payload) {
    const message =
      payload && typeof payload.message === 'string'
        ? payload.message
        : 'O Mercado Pago não conseguiu processar a solicitação.'
    const code =
      payload && typeof payload.error === 'string' ? payload.error : undefined
    throw new MercadoPagoPaymentError(message, response.status || 502, code)
  }

  return payload as MercadoPagoPaymentResponse
}

export function getMercadoPagoWebhookUrl() {
  const explicitUrl = process.env.MERCADO_PAGO_WEBHOOK_URL?.trim()
  const redirectUri = process.env.MERCADO_PAGO_OAUTH_REDIRECT_URI?.trim()
  if (!explicitUrl && !redirectUri) {
    throw new Error('A URL de webhook do Mercado Pago não está configurada.')
  }
  const fallbackOrigin = redirectUri
    ? new URL(redirectUri).origin
    : 'https://invalid.local'
  const webhookUrl = new URL(
    explicitUrl ??
      '/api/payment-providers/mercado-pago/webhook',
    fallbackOrigin
  )

  if (webhookUrl.protocol !== 'https:') {
    throw new Error('A URL de webhook do Mercado Pago deve usar HTTPS.')
  }

  return webhookUrl.toString()
}

export async function createMercadoPagoPixPayment(
  credentials: ProviderConnectionCredentials,
  input: CreateProviderChargeInput,
  idempotencyKey: string,
  fetchImpl: typeof fetch = fetch
) {
  if (!credentials.accessToken) {
    throw new Error('Token do Mercado Pago indisponível.')
  }

  if (!input.payer.email) {
    throw new Error(
      'Cadastre o e-mail do cliente antes de gerar um Pix dinâmico.'
    )
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const response = await fetchImpl(MERCADO_PAGO_PAYMENTS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${credentials.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      transaction_amount: input.amountCents / 100,
      description: input.description.slice(0, 255),
      payment_method_id: 'pix',
      external_reference: input.externalReference,
      notification_url: getMercadoPagoWebhookUrl(),
      date_of_expiration: expiresAt,
      payer: {
        email: input.payer.email,
        first_name: input.payer.name.slice(0, 100),
        ...(input.payer.cpf
          ? {
              identification: {
                type: 'CPF',
                number: input.payer.cpf.replace(/\D/g, ''),
              },
            }
          : {}),
      },
      additional_info: {
        items: [
          {
            id: input.billingCycleId,
            title: input.description.slice(0, 120),
            quantity: 1,
            unit_price: input.amountCents / 100,
          },
        ],
      },
    }),
    cache: 'no-store',
  })

  return normalizePayment(await parseResponse(response))
}

export async function getMercadoPagoPayment(
  credentials: ProviderConnectionCredentials,
  providerChargeId: string,
  fetchImpl: typeof fetch = fetch
) {
  if (!credentials.accessToken) {
    throw new Error('Token do Mercado Pago indisponível.')
  }

  if (!/^[A-Za-z0-9_-]+$/.test(providerChargeId)) {
    throw new Error('Identificador de pagamento inválido.')
  }

  const response = await fetchImpl(
    `${MERCADO_PAGO_PAYMENTS_URL}/${encodeURIComponent(providerChargeId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credentials.accessToken}`,
      },
      cache: 'no-store',
    }
  )

  return normalizePayment(await parseResponse(response))
}
