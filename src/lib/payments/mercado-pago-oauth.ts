import 'server-only'

import type {
  ProviderCapabilities,
  ProviderConnectionCredentials,
} from './provider-contract'

const MERCADO_PAGO_AUTHORIZATION_URL =
  'https://auth.mercadopago.com/authorization'
const MERCADO_PAGO_TOKEN_URL = 'https://api.mercadopago.com/oauth/token'
const MERCADO_PAGO_ACCOUNT_URL = 'https://api.mercadolibre.com/users/me'

export const MERCADO_PAGO_CAPABILITIES: ProviderCapabilities = {
  oauth: true,
  apiKey: false,
  dynamicPix: true,
  hostedCardCheckout: true,
  recurringCard: true,
  pixAutomatic: false,
}

export type MercadoPagoOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export type MercadoPagoToken = {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresIn: number
  scope: string[]
  userId: string
  liveMode: boolean
}

export type MercadoPagoAccount = {
  id: string
  displayName?: string
  siteId?: string
}

type TokenResponse = {
  access_token?: unknown
  refresh_token?: unknown
  token_type?: unknown
  expires_in?: unknown
  scope?: unknown
  user_id?: unknown
  live_mode?: unknown
}

type AccountResponse = {
  id?: unknown
  nickname?: unknown
  first_name?: unknown
  last_name?: unknown
  site_id?: unknown
}

export function getMercadoPagoOAuthConfig(): MercadoPagoOAuthConfig {
  const clientId = process.env.MERCADO_PAGO_CLIENT_ID?.trim()
  const clientSecret = process.env.MERCADO_PAGO_CLIENT_SECRET?.trim()
  const redirectUri = process.env.MERCADO_PAGO_OAUTH_REDIRECT_URI?.trim()

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('A integração Mercado Pago ainda não está configurada.')
  }

  const parsedRedirectUri = new URL(redirectUri)
  if (parsedRedirectUri.protocol !== 'https:') {
    throw new Error('A URL de retorno do Mercado Pago deve usar HTTPS.')
  }

  return { clientId, clientSecret, redirectUri: parsedRedirectUri.toString() }
}

export function isMercadoPagoOAuthConfigured() {
  try {
    getMercadoPagoOAuthConfig()
    return true
  } catch {
    return false
  }
}

export function createMercadoPagoAuthorizationUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}) {
  const url = new URL(MERCADO_PAGO_AUTHORIZATION_URL)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  url.searchParams.set('state', input.state)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

function parseTokenResponse(payload: TokenResponse): MercadoPagoToken {
  const accessToken =
    typeof payload.access_token === 'string' ? payload.access_token : ''
  const refreshToken =
    typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined
  const tokenType =
    typeof payload.token_type === 'string' ? payload.token_type : 'bearer'
  const expiresIn = Number(payload.expires_in)
  const userId =
    typeof payload.user_id === 'string' || typeof payload.user_id === 'number'
      ? String(payload.user_id)
      : ''

  if (
    !accessToken ||
    !userId ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error('O Mercado Pago retornou credenciais incompletas.')
  }

  return {
    accessToken,
    refreshToken,
    tokenType,
    expiresIn,
    scope:
      typeof payload.scope === 'string'
        ? payload.scope.split(/\s+/).filter(Boolean)
        : [],
    userId,
    liveMode: payload.live_mode === true,
  }
}

async function requestToken(body: Record<string, string>) {
  const response = await fetch(MERCADO_PAGO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    throw new Error(`O Mercado Pago recusou a autorização (${response.status}).`)
  }

  return parseTokenResponse((await response.json()) as TokenResponse)
}

export function exchangeMercadoPagoAuthorizationCode(input: {
  config: MercadoPagoOAuthConfig
  code: string
  codeVerifier: string
}) {
  return requestToken({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.config.redirectUri,
    code_verifier: input.codeVerifier,
  })
}

export function refreshMercadoPagoAccessToken(input: {
  config: MercadoPagoOAuthConfig
  refreshToken: string
}) {
  return requestToken({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })
}

export async function getMercadoPagoAccount(
  accessToken: string,
  expectedUserId: string
): Promise<MercadoPagoAccount> {
  const response = await fetch(MERCADO_PAGO_ACCOUNT_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    return { id: expectedUserId }
  }

  const payload = (await response.json()) as AccountResponse
  const id =
    typeof payload.id === 'string' || typeof payload.id === 'number'
      ? String(payload.id)
      : expectedUserId

  if (id !== expectedUserId) {
    throw new Error('A identidade retornada pelo Mercado Pago é inconsistente.')
  }

  const fullName = [payload.first_name, payload.last_name]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' ')
    .trim()
  const nickname =
    typeof payload.nickname === 'string' ? payload.nickname.trim() : ''

  return {
    id,
    displayName: fullName || nickname || undefined,
    siteId: typeof payload.site_id === 'string' ? payload.site_id : undefined,
  }
}

export function mercadoPagoCredentialsFromToken(
  token: MercadoPagoToken
): ProviderConnectionCredentials {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenType: token.tokenType,
  }
}

export function getMercadoPagoCredentialEncryptionContext(
  connectionId: string,
  tenantId: string
) {
  return `payment-credentials:mercado_pago:${tenantId}:${connectionId}`
}
