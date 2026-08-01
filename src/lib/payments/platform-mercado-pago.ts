import 'server-only'

const MERCADO_PAGO_ACCOUNT_URL = 'https://api.mercadolibre.com/users/me'

export type PlatformMercadoPagoAccount = {
  id: string
  displayName?: string
  nickname?: string
  siteId?: string
}

export type PlatformPaymentAccountRow = {
  provider: string
  status: string
  provider_account_id: string
  provider_account_name: string | null
  credential_source: string
  metadata: unknown
  connected_at: string | null
  last_validated_at: string | null
  last_error_code: string | null
}

export type SanitizedPlatformPaymentAccount = {
  provider: string
  status: string
  providerAccountId: string
  providerAccountName: string | null
  credentialSource: string
  nickname: string | null
  siteId: string | null
  connectedAt: string | null
  lastValidatedAt: string | null
  lastErrorCode: string | null
}

export type PlatformMercadoPagoValidationFailure =
  | 'configuration'
  | 'authentication'
  | 'identity'
  | 'unavailable'
  | 'invalid_response'

export class PlatformMercadoPagoValidationError extends Error {
  constructor(
    public readonly kind: PlatformMercadoPagoValidationFailure,
    public readonly safeCode: string
  ) {
    super('Platform Mercado Pago account validation failed.')
    this.name = 'PlatformMercadoPagoValidationError'
  }
}

type MercadoPagoAccountResponse = {
  id?: unknown
  nickname?: unknown
  first_name?: unknown
  last_name?: unknown
  site_id?: unknown
}

function readOptionalMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function getPlatformMercadoPagoConfig() {
  const accessToken = process.env.PLATFORM_MERCADO_PAGO_ACCESS_TOKEN?.trim()
  const accountId = process.env.PLATFORM_MERCADO_PAGO_ACCOUNT_ID?.trim()

  if (!accessToken || !accountId) {
    throw new PlatformMercadoPagoValidationError(
      'configuration',
      'platform_mercado_pago_not_configured'
    )
  }

  return { accessToken, accountId }
}

export function isPlatformMercadoPagoConfigured() {
  return Boolean(
    process.env.PLATFORM_MERCADO_PAGO_ACCESS_TOKEN?.trim() &&
      process.env.PLATFORM_MERCADO_PAGO_ACCOUNT_ID?.trim()
  )
}

export function sanitizePlatformPaymentAccount(
  row: PlatformPaymentAccountRow | null
): SanitizedPlatformPaymentAccount | null {
  if (!row) return null

  return {
    provider: row.provider,
    status: row.status,
    providerAccountId: row.provider_account_id,
    providerAccountName: row.provider_account_name,
    credentialSource: row.credential_source,
    nickname: readOptionalMetadataString(row.metadata, 'nickname'),
    siteId: readOptionalMetadataString(row.metadata, 'siteId'),
    connectedAt: row.connected_at,
    lastValidatedAt: row.last_validated_at,
    lastErrorCode: row.last_error_code,
  }
}

export async function validatePlatformMercadoPagoAccount(): Promise<PlatformMercadoPagoAccount> {
  const { accessToken, accountId } = getPlatformMercadoPagoConfig()
  let response: Response

  try {
    response = await fetch(MERCADO_PAGO_ACCOUNT_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new PlatformMercadoPagoValidationError(
      'unavailable',
      'mercado_pago_unavailable'
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new PlatformMercadoPagoValidationError(
      'authentication',
      'mercado_pago_access_denied'
    )
  }

  if (response.status === 429 || response.status >= 500) {
    throw new PlatformMercadoPagoValidationError(
      'unavailable',
      'mercado_pago_unavailable'
    )
  }

  if (!response.ok) {
    throw new PlatformMercadoPagoValidationError(
      'authentication',
      'mercado_pago_validation_rejected'
    )
  }

  let payload: MercadoPagoAccountResponse
  try {
    payload = (await response.json()) as MercadoPagoAccountResponse
  } catch {
    throw new PlatformMercadoPagoValidationError(
      'invalid_response',
      'mercado_pago_invalid_response'
    )
  }

  const id =
    typeof payload.id === 'string' || typeof payload.id === 'number'
      ? String(payload.id)
      : ''

  if (!id) {
    throw new PlatformMercadoPagoValidationError(
      'invalid_response',
      'mercado_pago_invalid_response'
    )
  }

  if (id !== accountId) {
    throw new PlatformMercadoPagoValidationError(
      'identity',
      'mercado_pago_account_mismatch'
    )
  }

  const displayName = [payload.first_name, payload.last_name]
    .filter(
      (value): value is string =>
        typeof value === 'string' && Boolean(value.trim())
    )
    .map((value) => value.trim())
    .join(' ')
  const nickname =
    typeof payload.nickname === 'string' && payload.nickname.trim()
      ? payload.nickname.trim()
      : undefined
  const siteId =
    typeof payload.site_id === 'string' && payload.site_id.trim()
      ? payload.site_id.trim()
      : undefined

  return {
    id,
    displayName: displayName || nickname,
    nickname,
    siteId,
  }
}
