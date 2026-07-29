import { randomUUID } from 'node:crypto'
import {
  decryptSensitiveJson,
  encryptProviderCredentials,
} from '../../../../../src/lib/payments/credential-crypto'
import {
  exchangeMercadoPagoAuthorizationCode,
  getMercadoPagoAccount,
  getMercadoPagoCredentialEncryptionContext,
  getMercadoPagoOAuthConfig,
  mercadoPagoCredentialsFromToken,
  MERCADO_PAGO_CAPABILITIES,
} from '../../../../../src/lib/payments/mercado-pago-oauth'
import {
  getOAuthStateEncryptionContext,
  hashOAuthState,
} from '../../../../../src/lib/payments/oauth-state'
import { createTenantAdminClient } from '../../../../../src/lib/tenant-admin'

export const runtime = 'nodejs'

function settingsRedirect(redirectUri: string, result: string) {
  const url = new URL('/settings', redirectUri)
  url.searchParams.set('payment_connection', result)
  return Response.redirect(url, 303)
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const state = requestUrl.searchParams.get('state')?.trim() ?? ''
  const authorizationCode = requestUrl.searchParams.get('code')?.trim() ?? ''
  const providerError = requestUrl.searchParams.get('error')?.trim() ?? ''

  if (!state || state.length > 256) {
    return Response.json({ error: 'Estado OAuth inválido.' }, { status: 400 })
  }

  const supabase = createTenantAdminClient()
  const { data: oauthState, error: stateError } = await supabase
    .from('tenant_payment_provider_oauth_states')
    .select(`
      id,
      tenant_id,
      tenant_user_id,
      provider,
      code_verifier_ciphertext,
      redirect_uri,
      expires_at,
      used_at
    `)
    .eq('state_hash', hashOAuthState(state))
    .eq('provider', 'mercado_pago')
    .maybeSingle()

  if (
    stateError ||
    !oauthState ||
    oauthState.used_at ||
    new Date(oauthState.expires_at).getTime() <= Date.now()
  ) {
    return Response.json(
      { error: 'Esta tentativa de conexão expirou ou já foi utilizada.' },
      { status: 400 }
    )
  }

  const usedAt = new Date().toISOString()
  const { data: consumedState, error: consumeError } = await supabase
    .from('tenant_payment_provider_oauth_states')
    .update({ used_at: usedAt })
    .eq('id', oauthState.id)
    .is('used_at', null)
    .gt('expires_at', usedAt)
    .select('id')
    .maybeSingle()

  if (consumeError || !consumedState) {
    return settingsRedirect(oauthState.redirect_uri, 'expired')
  }

  if (providerError) {
    return settingsRedirect(oauthState.redirect_uri, 'cancelled')
  }

  if (!authorizationCode) {
    return settingsRedirect(oauthState.redirect_uri, 'invalid_callback')
  }

  try {
    const secret = decryptSensitiveJson<{ codeVerifier?: unknown }>(
      oauthState.code_verifier_ciphertext,
      getOAuthStateEncryptionContext(
        oauthState.id,
        oauthState.tenant_id,
        'mercado_pago'
      )
    )

    if (typeof secret.codeVerifier !== 'string' || !secret.codeVerifier) {
      return settingsRedirect(oauthState.redirect_uri, 'invalid_state')
    }

    const config = getMercadoPagoOAuthConfig()
    if (config.redirectUri !== oauthState.redirect_uri) {
      return settingsRedirect(oauthState.redirect_uri, 'redirect_mismatch')
    }

    const token = await exchangeMercadoPagoAuthorizationCode({
      config,
      code: authorizationCode,
      codeVerifier: secret.codeVerifier,
    })

    if (!token.liveMode) {
      return settingsRedirect(oauthState.redirect_uri, 'production_required')
    }

    const account = await getMercadoPagoAccount(
      token.accessToken,
      token.userId
    )

    const { data: accountInUse } = await supabase
      .from('tenant_payment_provider_connections')
      .select('id, tenant_id')
      .eq('provider', 'mercado_pago')
      .eq('provider_account_id', account.id)
      .in('status', ['connected', 'needs_reauthorization'])
      .maybeSingle()

    if (accountInUse && accountInUse.tenant_id !== oauthState.tenant_id) {
      return settingsRedirect(oauthState.redirect_uri, 'account_in_use')
    }

    const { data: existingConnection, error: existingError } = await supabase
      .from('tenant_payment_provider_connections')
      .select('id')
      .eq('tenant_id', oauthState.tenant_id)
      .eq('provider', 'mercado_pago')
      .maybeSingle()

    if (existingError) {
      return settingsRedirect(oauthState.redirect_uri, 'connection_failed')
    }

    const connectionId = existingConnection?.id ?? randomUUID()
    const credentialContext = getMercadoPagoCredentialEncryptionContext(
      connectionId,
      oauthState.tenant_id
    )
    const credentialsCiphertext = encryptProviderCredentials(
      mercadoPagoCredentialsFromToken(token),
      credentialContext
    )
    const now = new Date().toISOString()
    const connectionData = {
      tenant_id: oauthState.tenant_id,
      provider: 'mercado_pago',
      connection_mode: 'oauth',
      status: 'connected',
      provider_account_id: account.id,
      provider_account_name: account.displayName ?? `Mercado Pago #${account.id}`,
      credentials_ciphertext: credentialsCiphertext,
      credentials_key_version: 1,
      granted_scopes: token.scope,
      capabilities: MERCADO_PAGO_CAPABILITIES,
      metadata: {
        live_mode: true,
        site_id: account.siteId ?? null,
      },
      token_expires_at: new Date(
        Date.now() + token.expiresIn * 1000
      ).toISOString(),
      connected_at: now,
      disconnected_at: null,
      last_validated_at: now,
      last_error_code: null,
      created_by_tenant_user_id: oauthState.tenant_user_id,
      updated_at: now,
    }

    const connectionQuery = existingConnection
      ? supabase
          .from('tenant_payment_provider_connections')
          .update(connectionData)
          .eq('id', connectionId)
          .eq('tenant_id', oauthState.tenant_id)
          .eq('provider', 'mercado_pago')
      : supabase
          .from('tenant_payment_provider_connections')
          .insert({ id: connectionId, ...connectionData })

    const { error: connectionError } = await connectionQuery

    if (connectionError) {
      return settingsRedirect(
        oauthState.redirect_uri,
        connectionError.code === '23505'
          ? 'account_in_use'
          : 'connection_failed'
      )
    }

    return settingsRedirect(oauthState.redirect_uri, 'connected')
  } catch {
    return settingsRedirect(oauthState.redirect_uri, 'connection_failed')
  }
}
