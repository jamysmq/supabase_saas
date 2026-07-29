import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptProviderCredentials } from './credential-crypto'
import { refreshMercadoPagoConnectionIfNeeded } from './mercado-pago-connection'
import { getMercadoPagoCredentialEncryptionContext } from './mercado-pago-oauth'
import type { ProviderConnectionCredentials } from './provider-contract'

type RuntimeConnection = {
  id: string
  tenant_id: string
  provider_account_id: string | null
  status: string
  credentials_ciphertext: string | null
  token_expires_at: string | null
  granted_scopes: string[] | null
}

export type UsableMercadoPagoConnection = {
  id: string
  tenantId: string
  providerAccountId: string
  credentials: ProviderConnectionCredentials
}

export async function getUsableMercadoPagoConnection(
  supabase: SupabaseClient,
  tenantId: string
): Promise<UsableMercadoPagoConnection> {
  const { data: initial, error: initialError } = await supabase
    .from('tenant_payment_provider_connections')
    .select(
      'id, tenant_id, provider_account_id, status, credentials_ciphertext, token_expires_at, granted_scopes'
    )
    .eq('tenant_id', tenantId)
    .eq('provider', 'mercado_pago')
    .maybeSingle<RuntimeConnection>()

  if (initialError) throw initialError
  if (!initial) throw new Error('Conecte uma conta Mercado Pago antes de usar o Pix dinâmico.')

  await refreshMercadoPagoConnectionIfNeeded(supabase, initial)

  const { data: current, error: currentError } = await supabase
    .from('tenant_payment_provider_connections')
    .select(
      'id, tenant_id, provider_account_id, status, credentials_ciphertext, token_expires_at, granted_scopes'
    )
    .eq('id', initial.id)
    .eq('tenant_id', tenantId)
    .eq('provider', 'mercado_pago')
    .single<RuntimeConnection>()

  if (currentError) throw currentError
  if (
    current.status !== 'connected' ||
    !current.provider_account_id ||
    !current.credentials_ciphertext
  ) {
    throw new Error('A conta Mercado Pago precisa ser reconectada.')
  }

  const credentials = decryptProviderCredentials(
    current.credentials_ciphertext,
    getMercadoPagoCredentialEncryptionContext(current.id, tenantId)
  )

  if (!credentials.accessToken) {
    throw new Error('O acesso ao Mercado Pago está indisponível.')
  }

  return {
    id: current.id,
    tenantId,
    providerAccountId: current.provider_account_id,
    credentials,
  }
}

