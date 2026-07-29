import {
  encryptSensitiveJson,
} from '../../../../../src/lib/payments/credential-crypto'
import {
  createMercadoPagoAuthorizationUrl,
  getMercadoPagoOAuthConfig,
  isMercadoPagoOAuthConfigured,
} from '../../../../../src/lib/payments/mercado-pago-oauth'
import {
  createPaymentOAuthAttempt,
  getOAuthStateEncryptionContext,
} from '../../../../../src/lib/payments/oauth-state'
import {
  refreshMercadoPagoConnectionIfNeeded,
} from '../../../../../src/lib/payments/mercado-pago-connection'
import { isMercadoPagoWebhookConfigured } from '../../../../../src/lib/payments/mercado-pago-webhook'
import { requireTenantUser } from '../../../../../src/lib/tenant-admin'

export const runtime = 'nodejs'

const publicConnectionFields = `
  id,
  provider,
  connection_mode,
  status,
  provider_account_id,
  provider_account_name,
  granted_scopes,
  capabilities,
  token_expires_at,
  connected_at,
  disconnected_at,
  last_validated_at,
  last_error_code
`

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  const { data: internalConnection, error: internalError } = await result.supabase
    .from('tenant_payment_provider_connections')
    .select('id, tenant_id, status, credentials_ciphertext, token_expires_at, granted_scopes')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('provider', 'mercado_pago')
    .maybeSingle()

  if (internalError) {
    return errorResponse(
      'Não foi possível carregar a conexão do Mercado Pago.',
      500,
      internalError.message
    )
  }

  if (internalConnection && isMercadoPagoOAuthConfigured()) {
    await refreshMercadoPagoConnectionIfNeeded(
      result.supabase,
      internalConnection
    )
  }

  const { data: connection, error } = await result.supabase
    .from('tenant_payment_provider_connections')
    .select(publicConnectionFields)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('provider', 'mercado_pago')
    .maybeSingle()

  if (error) {
    return errorResponse(
      'Não foi possível carregar a conexão do Mercado Pago.',
      500,
      error.message
    )
  }

  return Response.json(
    {
      configured: isMercadoPagoOAuthConfigured(),
      webhook_configured: isMercadoPagoWebhookConfigured(),
      connection,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenant.status !== 'active') {
    return errorResponse('Ative o estabelecimento antes de conectar uma conta.', 403)
  }

  let config
  try {
    config = getMercadoPagoOAuthConfig()
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : 'A integração Mercado Pago ainda não está configurada.',
      503
    )
  }

  const attempt = createPaymentOAuthAttempt()
  let verifierCiphertext = ''

  try {
    verifierCiphertext = encryptSensitiveJson(
      { codeVerifier: attempt.codeVerifier },
      getOAuthStateEncryptionContext(
        attempt.id,
        result.tenantUser.tenant_id,
        'mercado_pago'
      )
    )
  } catch {
    return errorResponse(
      'A chave de proteção das credenciais ainda não está configurada.',
      503
    )
  }

  await result.supabase
    .from('tenant_payment_provider_oauth_states')
    .delete()
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('tenant_user_id', result.tenantUser.id)
    .eq('provider', 'mercado_pago')

  const { error } = await result.supabase
    .from('tenant_payment_provider_oauth_states')
    .insert({
      id: attempt.id,
      tenant_id: result.tenantUser.tenant_id,
      tenant_user_id: result.tenantUser.id,
      provider: 'mercado_pago',
      state_hash: attempt.stateHash,
      code_verifier_ciphertext: verifierCiphertext,
      redirect_uri: config.redirectUri,
      expires_at: attempt.expiresAt,
    })

  if (error) {
    return errorResponse(
      'Não foi possível iniciar a conexão com o Mercado Pago.',
      500,
      error.message
    )
  }

  return Response.json(
    {
      authorization_url: createMercadoPagoAuthorizationUrl({
        clientId: config.clientId,
        redirectUri: config.redirectUri,
        state: attempt.state,
        codeChallenge: attempt.codeChallenge,
      }),
      expires_at: attempt.expiresAt,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function DELETE(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  const now = new Date().toISOString()
  const { data, error } = await result.supabase
    .from('tenant_payment_provider_connections')
    .update({
      status: 'disabled',
      credentials_ciphertext: null,
      granted_scopes: [],
      capabilities: {},
      token_expires_at: null,
      disconnected_at: now,
      last_error_code: null,
      updated_at: now,
    })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .eq('provider', 'mercado_pago')
    .select('id')
    .maybeSingle()

  if (error) {
    return errorResponse(
      'Não foi possível desconectar o Mercado Pago.',
      500,
      error.message
    )
  }

  if (data) {
    const { error: settingsError } = await result.supabase
      .from('tenant_billing_settings')
      .update({
        payment_automation_enabled: false,
        pix_collection_mode: 'tenant_key',
        default_payment_provider: null,
        updated_at: now,
      })
      .eq('tenant_id', result.tenantUser.tenant_id)

    if (settingsError) {
      return errorResponse(
        'A conta foi desconectada, mas não foi possível restaurar o Pix manual.',
        500,
        settingsError.message
      )
    }
  }

  return Response.json({ ok: true, disconnected: Boolean(data) })
}
