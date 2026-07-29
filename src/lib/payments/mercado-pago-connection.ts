import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decryptProviderCredentials,
  encryptProviderCredentials,
} from './credential-crypto'
import {
  getMercadoPagoCredentialEncryptionContext,
  getMercadoPagoOAuthConfig,
  mercadoPagoCredentialsFromToken,
  refreshMercadoPagoAccessToken,
} from './mercado-pago-oauth'

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type MercadoPagoConnectionRow = {
  id: string
  tenant_id: string
  status: string
  credentials_ciphertext: string | null
  token_expires_at: string | null
  granted_scopes: string[] | null
}

export async function refreshMercadoPagoConnectionIfNeeded(
  supabase: SupabaseClient,
  connection: MercadoPagoConnectionRow
) {
  if (
    connection.status !== 'connected' ||
    !connection.credentials_ciphertext ||
    !connection.token_expires_at
  ) {
    return
  }

  const expiresAt = new Date(connection.token_expires_at).getTime()
  if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return
  }

  const context = getMercadoPagoCredentialEncryptionContext(
    connection.id,
    connection.tenant_id
  )

  try {
    const credentials = decryptProviderCredentials(
      connection.credentials_ciphertext,
      context
    )

    if (!credentials.refreshToken) {
      throw new Error('Refresh token indisponível.')
    }

    const token = await refreshMercadoPagoAccessToken({
      config: getMercadoPagoOAuthConfig(),
      refreshToken: credentials.refreshToken,
    })

    if (!token.liveMode) {
      throw new Error('Token de produção inválido.')
    }

    const refreshedCredentials = mercadoPagoCredentialsFromToken(token)
    const { error } = await supabase
      .from('tenant_payment_provider_connections')
      .update({
        credentials_ciphertext: encryptProviderCredentials(
          refreshedCredentials,
          context
        ),
        token_expires_at: new Date(
          Date.now() + token.expiresIn * 1000
        ).toISOString(),
        granted_scopes: token.scope,
        last_validated_at: new Date().toISOString(),
        last_error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id)
      .eq('tenant_id', connection.tenant_id)
      .eq('provider', 'mercado_pago')

    if (error) throw error
  } catch {
    await supabase
      .from('tenant_payment_provider_connections')
      .update({
        status: 'needs_reauthorization',
        last_error_code: 'token_refresh_failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id)
      .eq('tenant_id', connection.tenant_id)
      .eq('provider', 'mercado_pago')
  }
}
