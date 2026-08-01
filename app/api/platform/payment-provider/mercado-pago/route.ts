import { requirePlatformAdmin } from '../../../../../src/lib/platform-admin'
import {
  isPlatformMercadoPagoConfigured,
  PlatformMercadoPagoValidationError,
  sanitizePlatformPaymentAccount,
  validatePlatformMercadoPagoAccount,
  type PlatformPaymentAccountRow,
} from '../../../../../src/lib/payments/platform-mercado-pago'

const ACCOUNT_SELECT =
  'provider, status, provider_account_id, provider_account_name, credential_source, metadata, connected_at, last_validated_at, last_error_code'

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  const { data, error } = await result.supabase
    .from('platform_payment_provider_accounts')
    .select(ACCOUNT_SELECT)
    .eq('provider', 'mercado_pago')
    .maybeSingle()

  if (error) {
    return Response.json(
      { error: 'Não foi possível consultar a conta oficial.' },
      { status: 500 }
    )
  }

  return Response.json({
    configured: isPlatformMercadoPagoConfigured(),
    account: sanitizePlatformPaymentAccount(
      data as PlatformPaymentAccountRow | null
    ),
  })
}

export async function POST(request: Request) {
  const result = await requirePlatformAdmin(request)
  if (result.error) return result.error

  try {
    const account = await validatePlatformMercadoPagoAccount()
    const now = new Date().toISOString()
    const { data, error } = await result.supabase
      .from('platform_payment_provider_accounts')
      .upsert(
        {
          provider: 'mercado_pago',
          status: 'connected',
          provider_account_id: account.id,
          provider_account_name: account.displayName ?? null,
          credential_source: 'environment',
          metadata: {
            nickname: account.nickname ?? null,
            siteId: account.siteId ?? null,
          },
          connected_at: now,
          last_validated_at: now,
          last_error_code: null,
          updated_at: now,
        },
        { onConflict: 'provider' }
      )
      .select(ACCOUNT_SELECT)
      .single()

    if (error) {
      return Response.json(
        { error: 'A conta foi validada, mas não foi possível salvar os metadados.' },
        { status: 500 }
      )
    }

    return Response.json({
      configured: true,
      account: sanitizePlatformPaymentAccount(
        data as PlatformPaymentAccountRow
      ),
      message: 'Conta oficial validada com sucesso.',
    })
  } catch (error) {
    const validationError =
      error instanceof PlatformMercadoPagoValidationError
        ? error
        : new PlatformMercadoPagoValidationError(
            'unavailable',
            'mercado_pago_unavailable'
          )
    const needsReauthorization =
      validationError.kind === 'authentication' ||
      validationError.kind === 'identity'
    const now = new Date().toISOString()

    await result.supabase
      .from('platform_payment_provider_accounts')
      .update({
        status: needsReauthorization ? 'needs_reauthorization' : 'error',
        last_error_code: validationError.safeCode,
        updated_at: now,
      })
      .eq('provider', 'mercado_pago')

    const providerUnavailable =
      validationError.kind === 'configuration' ||
      validationError.kind === 'unavailable'

    return Response.json(
      {
        error: providerUnavailable
          ? 'O Mercado Pago não está disponível para validação no momento.'
          : 'Não foi possível validar a identidade da conta oficial do Mercado Pago.',
        code: validationError.safeCode,
      },
      { status: providerUnavailable ? 503 : 502 }
    )
  }
}
