import 'server-only'

import { getPlatformMercadoPagoConfig } from './platform-mercado-pago'

const MERCADO_PAGO_PREAPPROVAL_URL = 'https://api.mercadopago.com/preapproval'
const MERCADO_PAGO_AUTHORIZED_PAYMENTS_URL =
  'https://api.mercadopago.com/authorized_payments'
const MERCADO_PAGO_PAYMENTS_URL = 'https://api.mercadopago.com/v1/payments'
const MERCADO_PAGO_REQUEST_TIMEOUT_MS = 20_000

export function isPlatformSubscriptionsEnabled() {
  return process.env.PLATFORM_SUBSCRIPTIONS_ENABLED?.trim().toLowerCase() === 'true'
}

export function isPlatformSubscriptionsEnabledForTenant(tenantId: string) {
  if (!isPlatformSubscriptionsEnabled()) return false

  const allowlist = (process.env.PLATFORM_SUBSCRIPTIONS_TENANT_ALLOWLIST ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return allowlist.includes('*') || allowlist.includes(tenantId)
}

export type PlatformProviderSubscriptionStatus =
  | 'pending'
  | 'authorized'
  | 'paused'
  | 'cancelled'

export type PlatformMercadoPagoSubscription = {
  providerSubscriptionId: string
  externalReference: string
  status: PlatformProviderSubscriptionStatus
  checkoutUrl: string | null
  amountCents: number
  currency: 'BRL'
  payerEmail: string
  payerId: string | null
  paymentMethodId: string | null
  nextPaymentAt: string | null
}

export type PlatformMercadoPagoAuthorizedPayment = {
  invoiceId: string
  preapprovalId: string
  externalReference: string
  currency: 'BRL'
  amountCents: number
  debitDate: string
  status: string
  summarized: string
  payment: {
    id: string
    status: string
    statusDetail: string | null
  } | null
}

export type PlatformMercadoPagoRecurringPayment = {
  paymentId: string
  collectorId: string
  externalReference: string
  currency: 'BRL'
  amountCents: number
  status: string
  statusDetail: string | null
  dateCreated: string | null
  dateApproved: string | null
  dateLastUpdated: string | null
  paymentMethodId: string | null
  feeCents: number
  netReceivedAmountCents: number
  refundedAmountCents: number
}

type MercadoPagoPreapprovalResponse = {
  id?: unknown
  collector_id?: unknown
  external_reference?: unknown
  status?: unknown
  init_point?: unknown
  payer_email?: unknown
  payer_id?: unknown
  payment_method_id?: unknown
  next_payment_date?: unknown
  auto_recurring?: {
    transaction_amount?: unknown
    currency_id?: unknown
  } | null
  message?: unknown
  error?: unknown
}

type MercadoPagoAuthorizedPaymentResponse = {
  id?: unknown
  preapproval_id?: unknown
  external_reference?: unknown
  currency_id?: unknown
  transaction_amount?: unknown
  debit_date?: unknown
  status?: unknown
  summarized?: unknown
  payment?: {
    id?: unknown
    status?: unknown
    status_detail?: unknown
  } | null
}

type MercadoPagoRecurringPaymentResponse = {
  id?: unknown
  collector_id?: unknown
  external_reference?: unknown
  currency_id?: unknown
  transaction_amount?: unknown
  status?: unknown
  status_detail?: unknown
  date_created?: unknown
  date_approved?: unknown
  date_last_updated?: unknown
  payment_method_id?: unknown
  fee_details?: Array<{
    amount?: unknown
  }> | null
  transaction_details?: {
    net_received_amount?: unknown
  } | null
  transaction_amount_refunded?: unknown
}

export class PlatformMercadoPagoSubscriptionError extends Error {
  constructor(
    public readonly safeCode: string,
    public readonly status = 502
  ) {
    super('Platform Mercado Pago subscription request failed.')
    this.name = 'PlatformMercadoPagoSubscriptionError'
  }
}

function readString(value: unknown) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function mapStatus(value: unknown): PlatformProviderSubscriptionStatus {
  const status = readString(value)
  if (status === 'canceled' || status === 'cancelled') return 'cancelled'
  if (status === 'authorized' || status === 'paused') {
    return status
  }
  return 'pending'
}

function amountToCents(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0
}

function getSubscriptionRequestConfig() {
  try {
    return getPlatformMercadoPagoConfig()
  } catch {
    throw new PlatformMercadoPagoSubscriptionError(
      'platform_mercado_pago_not_configured',
      500
    )
  }
}

function normalizeSubscription(
  payload: MercadoPagoPreapprovalResponse,
  expectedAccountId: string
): PlatformMercadoPagoSubscription {
  const providerSubscriptionId = readString(payload.id)
  const collectorId = readString(payload.collector_id)
  const externalReference = readString(payload.external_reference)
  const payerEmail = readString(payload.payer_email)
  const currency = readString(payload.auto_recurring?.currency_id)
  const amountCents = amountToCents(payload.auto_recurring?.transaction_amount)

  if (
    !providerSubscriptionId ||
    !externalReference ||
    !payerEmail ||
    currency !== 'BRL' ||
    amountCents <= 0
  ) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_invalid_subscription_response'
    )
  }

  if (!collectorId || collectorId !== expectedAccountId) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_platform_account_mismatch'
    )
  }

  const checkoutUrl = readString(payload.init_point)
  if (checkoutUrl) {
    let parsed: URL
    try {
      parsed = new URL(checkoutUrl)
    } catch {
      throw new PlatformMercadoPagoSubscriptionError(
        'mercado_pago_invalid_checkout_url'
      )
    }

    if (
      parsed.protocol !== 'https:' ||
      (parsed.hostname !== 'mercadopago.com.br' &&
        !parsed.hostname.endsWith('.mercadopago.com.br'))
    ) {
      throw new PlatformMercadoPagoSubscriptionError(
        'mercado_pago_invalid_checkout_url'
      )
    }
  }

  return {
    providerSubscriptionId,
    externalReference,
    status: mapStatus(payload.status),
    checkoutUrl: checkoutUrl || null,
    amountCents,
    currency: 'BRL',
    payerEmail,
    payerId: readString(payload.payer_id) || null,
    paymentMethodId: readString(payload.payment_method_id) || null,
    nextPaymentAt: readString(payload.next_payment_date) || null,
  }
}

function normalizeAuthorizedPayment(
  payload: MercadoPagoAuthorizedPaymentResponse
): PlatformMercadoPagoAuthorizedPayment {
  const invoiceId = readString(payload.id)
  const preapprovalId = readString(payload.preapproval_id)
  const externalReference = readString(payload.external_reference)
  const currency = readString(payload.currency_id)
  const amountCents = amountToCents(payload.transaction_amount)
  const debitDate = readString(payload.debit_date)
  const status = readString(payload.status)
  const summarized = readString(payload.summarized)

  if (
    !/^\d+$/.test(invoiceId) ||
    !preapprovalId ||
    !externalReference ||
    currency !== 'BRL' ||
    amountCents <= 0 ||
    !debitDate ||
    !status ||
    !summarized
  ) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_invalid_authorized_payment_response'
    )
  }

  let payment: PlatformMercadoPagoAuthorizedPayment['payment'] = null
  if (payload.payment != null) {
    const id = readString(payload.payment.id)
    const paymentStatus = readString(payload.payment.status)

    if (!id || !paymentStatus) {
      throw new PlatformMercadoPagoSubscriptionError(
        'mercado_pago_invalid_authorized_payment_response'
      )
    }

    payment = {
      id,
      status: paymentStatus,
      statusDetail: readString(payload.payment.status_detail) || null,
    }
  }

  return {
    invoiceId,
    preapprovalId,
    externalReference,
    currency: 'BRL',
    amountCents,
    debitDate,
    status,
    summarized,
    payment,
  }
}

function normalizeRecurringPayment(
  payload: MercadoPagoRecurringPaymentResponse,
  expectedAccountId: string
): PlatformMercadoPagoRecurringPayment {
  const paymentId = readString(payload.id)
  const collectorId = readString(payload.collector_id)
  const externalReference = readString(payload.external_reference)
  const currency = readString(payload.currency_id)
  const amountCents = amountToCents(payload.transaction_amount)
  const status = readString(payload.status)

  if (
    !paymentId ||
    !externalReference ||
    currency !== 'BRL' ||
    amountCents <= 0 ||
    !status
  ) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_invalid_recurring_payment_response'
    )
  }

  if (!collectorId || collectorId !== expectedAccountId) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_platform_account_mismatch'
    )
  }

  const feeCents = Array.isArray(payload.fee_details)
    ? payload.fee_details.reduce(
        (total, fee) => total + amountToCents(fee?.amount),
        0
      )
    : 0

  return {
    paymentId,
    collectorId,
    externalReference,
    currency: 'BRL',
    amountCents,
    status,
    statusDetail: readString(payload.status_detail) || null,
    dateCreated: readString(payload.date_created) || null,
    dateApproved: readString(payload.date_approved) || null,
    dateLastUpdated: readString(payload.date_last_updated) || null,
    paymentMethodId: readString(payload.payment_method_id) || null,
    feeCents,
    netReceivedAmountCents: amountToCents(
      payload.transaction_details?.net_received_amount
    ),
    refundedAmountCents: amountToCents(payload.transaction_amount_refunded),
  }
}

async function parseAuthorizedPaymentResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | MercadoPagoAuthorizedPaymentResponse
    | null

  if (!response.ok || !payload) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_authorized_payment_rejected',
      response.status || 502
    )
  }

  return normalizeAuthorizedPayment(payload)
}

async function parseRecurringPaymentResponse(
  response: Response,
  expectedAccountId: string
) {
  const payload = (await response.json().catch(() => null)) as
    | MercadoPagoRecurringPaymentResponse
    | null

  if (!response.ok || !payload) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_recurring_payment_rejected',
      response.status || 502
    )
  }

  return normalizeRecurringPayment(payload, expectedAccountId)
}

async function parseResponse(
  response: Response,
  expectedAccountId: string
) {
  const payload = (await response.json().catch(() => null)) as
    | MercadoPagoPreapprovalResponse
    | null

  if (!response.ok || !payload) {
    const providerCode = readString(payload?.error)
    throw new PlatformMercadoPagoSubscriptionError(
      providerCode
        ? `mercado_pago_${providerCode.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`
        : 'mercado_pago_subscription_rejected',
      response.status || 502
    )
  }

  return normalizeSubscription(payload, expectedAccountId)
}

export function getPlatformSubscriptionBackUrl() {
  const baseUrl =
    process.env.APP_BASE_URL?.trim() ||
    'https://app.meuassistentevirtual.com.br'
  const url = new URL('/settings', baseUrl)
  url.searchParams.set('platform_subscription', 'return')
  return url.toString()
}

export async function createPlatformMercadoPagoSubscription(input: {
  externalReference: string
  tenantName: string
  payerEmail: string
  amountCents: number
}) {
  const { accessToken, accountId } = getPlatformMercadoPagoConfig()
  const response = await fetch(MERCADO_PAGO_PREAPPROVAL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: `Assistente Jack - ${input.tenantName}`.slice(0, 255),
      external_reference: input.externalReference,
      payer_email: input.payerEmail,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: input.amountCents / 100,
        currency_id: 'BRL',
      },
      back_url: getPlatformSubscriptionBackUrl(),
      status: 'pending',
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  })

  return parseResponse(response, accountId)
}

export async function getPlatformMercadoPagoSubscription(
  providerSubscriptionId: string
) {
  if (!/^[A-Za-z0-9_-]+$/.test(providerSubscriptionId)) {
    throw new PlatformMercadoPagoSubscriptionError(
      'invalid_provider_subscription_id',
      400
    )
  }

  const { accessToken, accountId } = getPlatformMercadoPagoConfig()
  const response = await fetch(
    `${MERCADO_PAGO_PREAPPROVAL_URL}/${encodeURIComponent(providerSubscriptionId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }
  )

  return parseResponse(response, accountId)
}

export async function getPlatformMercadoPagoAuthorizedPayment(
  invoiceId: string
) {
  if (!/^\d+$/.test(invoiceId)) {
    throw new PlatformMercadoPagoSubscriptionError(
      'invalid_authorized_payment_id',
      400
    )
  }

  const { accessToken } = getSubscriptionRequestConfig()
  let response: Response
  try {
    response = await fetch(
      `${MERCADO_PAGO_AUTHORIZED_PAYMENTS_URL}/${encodeURIComponent(invoiceId)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(MERCADO_PAGO_REQUEST_TIMEOUT_MS),
      }
    )
  } catch {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_authorized_payment_unavailable'
    )
  }

  return parseAuthorizedPaymentResponse(response)
}

export async function getPlatformMercadoPagoRecurringPayment(paymentId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(paymentId)) {
    throw new PlatformMercadoPagoSubscriptionError(
      'invalid_recurring_payment_id',
      400
    )
  }

  const { accessToken, accountId } = getSubscriptionRequestConfig()
  let response: Response
  try {
    response = await fetch(
      `${MERCADO_PAGO_PAYMENTS_URL}/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(MERCADO_PAGO_REQUEST_TIMEOUT_MS),
      }
    )
  } catch {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_recurring_payment_unavailable'
    )
  }

  return parseRecurringPaymentResponse(response, accountId)
}
