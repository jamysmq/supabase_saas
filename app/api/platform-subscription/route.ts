import { randomUUID } from 'node:crypto'
import { requireTenantUser } from '../../../src/lib/tenant-admin'
import {
  createPlatformMercadoPagoSubscription,
  getPlatformMercadoPagoSubscription,
  isPlatformSubscriptionsEnabledForTenant,
  PlatformMercadoPagoSubscriptionError,
} from '../../../src/lib/payments/platform-mercado-pago-subscriptions'

export const runtime = 'nodejs'

const currentStatuses = ['creating', 'pending', 'authorized', 'paused']

type SubscriptionRow = {
  id: string
  tenant_id: string
  subscription_id: string | null
  billing_profile_id: string
  provider: string
  provider_subscription_id: string | null
  external_reference: string
  status: string
  payer_email: string
  amount_cents: number
  currency: string
  checkout_url: string | null
  provider_payment_method_id: string | null
  next_payment_at: string | null
  authorized_at: string | null
  last_synced_at: string | null
  last_error_code: string | null
  created_at: string
}

function errorResponse(message: string, status = 400) {
  return Response.json({ error: message, message }, { status })
}

function sanitize(row: SubscriptionRow | null, expectedAmountCents?: number) {
  if (!row) return null
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    amount_cents: row.amount_cents,
    currency: row.currency,
    checkout_url: row.status === 'pending' ? row.checkout_url : null,
    payment_method_id: row.provider_payment_method_id,
    next_payment_at: row.next_payment_at,
    authorized_at: row.authorized_at,
    last_synced_at: row.last_synced_at,
    amount_matches_profile:
      expectedAmountCents === undefined || row.amount_cents === expectedAmountCents,
  }
}

async function loadContext(
  result: Awaited<ReturnType<typeof requireTenantUser>> & { error?: undefined }
) {
  const tenantId = result.tenantUser.tenant_id
  const [tenantResult, profileResult, accountResult, currentResult] =
    await Promise.all([
      result.supabase
        .from('tenants')
        .select('id, legal_name, email, status')
        .eq('id', tenantId)
        .single(),
      result.supabase
        .from('platform_tenant_billing_profiles')
        .select('id, subscription_id, amount_cents, currency, due_day, status')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      result.supabase
        .from('platform_payment_provider_accounts')
        .select('provider, status, provider_account_id')
        .eq('provider', 'mercado_pago')
        .maybeSingle(),
      result.supabase
        .from('platform_payment_provider_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('provider', 'mercado_pago')
        .in('status', currentStatuses)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  if (tenantResult.error || !tenantResult.data) {
    throw new Error('tenant_lookup_failed')
  }
  if (profileResult.error) throw new Error('billing_profile_lookup_failed')
  if (accountResult.error) throw new Error('platform_account_lookup_failed')
  if (currentResult.error) throw new Error('subscription_lookup_failed')

  return {
    tenant: tenantResult.data,
    profile: profileResult.data,
    account: accountResult.data,
    current: currentResult.data as SubscriptionRow | null,
  }
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  try {
    const context = await loadContext(result)
    let current = context.current

    if (
      current?.provider_subscription_id &&
      ['pending', 'authorized', 'paused'].includes(current.status)
    ) {
      try {
        const provider = await getPlatformMercadoPagoSubscription(
          current.provider_subscription_id
        )
        if (provider.externalReference !== current.external_reference) {
          throw new PlatformMercadoPagoSubscriptionError(
            'mercado_pago_external_reference_mismatch'
          )
        }
        if (
          provider.amountCents !== current.amount_cents ||
          provider.payerEmail.toLowerCase() !==
            current.payer_email.toLowerCase()
        ) {
          throw new PlatformMercadoPagoSubscriptionError(
            'mercado_pago_subscription_identity_mismatch'
          )
        }

        const now = new Date().toISOString()
        const authorizedAt =
          provider.status === 'authorized'
            ? current.authorized_at ?? now
            : current.authorized_at
        const { data: updated } = await result.supabase
          .from('platform_payment_provider_subscriptions')
          .update({
            status: provider.status,
            checkout_url: provider.checkoutUrl,
            provider_payment_method_id: provider.paymentMethodId,
            provider_payer_id: provider.payerId,
            next_payment_at: provider.nextPaymentAt,
            authorized_at: authorizedAt,
            cancelled_at:
              provider.status === 'cancelled' ? now : null,
            last_synced_at: now,
            last_error_code: null,
            updated_at: now,
          })
          .eq('id', current.id)
          .eq('tenant_id', result.tenantUser.tenant_id)
          .select('*')
          .single()

        if (updated) current = updated as SubscriptionRow
      } catch (error) {
        console.error(
          'Não foi possível sincronizar a assinatura oficial do tenant.',
          error instanceof PlatformMercadoPagoSubscriptionError
            ? error.safeCode
            : 'unknown_error'
        )
      }
    }

    return Response.json({
      configured:
        isPlatformSubscriptionsEnabledForTenant(result.tenantUser.tenant_id) &&
        context.account?.status === 'connected' &&
        Boolean(context.profile),
      billing_profile: context.profile
        ? {
            amount_cents: context.profile.amount_cents,
            currency: context.profile.currency,
            due_day: context.profile.due_day,
          }
        : null,
      subscription: sanitize(
        current,
        context.profile?.amount_cents
      ),
    })
  } catch {
    return errorResponse(
      'Não foi possível carregar a assinatura da plataforma.',
      500
    )
  }
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (result.tenantUser.role !== 'admin') {
    return errorResponse('Apenas o administrador pode configurar a assinatura.', 403)
  }
  if (
    !isPlatformSubscriptionsEnabledForTenant(result.tenantUser.tenant_id)
  ) {
    return errorResponse(
      'A cobrança automática da assinatura ainda não está disponível.',
      503
    )
  }

  try {
    const context = await loadContext(result)
    if (context.tenant.status !== 'active') {
      return errorResponse('O negócio precisa estar ativo para configurar a assinatura.')
    }
    if (context.account?.status !== 'connected') {
      return errorResponse('A conta oficial de recebimento está indisponível.', 503)
    }
    if (
      !context.profile ||
      context.profile.amount_cents <= 0 ||
      context.profile.currency !== 'BRL'
    ) {
      return errorResponse('O perfil de cobrança da plataforma está incompleto.')
    }

    const email = String(context.tenant.email ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return errorResponse('Cadastre um e-mail válido antes de configurar a assinatura.')
    }

    if (context.current) {
      if (
        context.current.status === 'pending' &&
        context.current.checkout_url &&
        context.current.amount_cents === context.profile.amount_cents &&
        context.current.payer_email === email
      ) {
        return Response.json({
          subscription: sanitize(context.current, context.profile.amount_cents),
        })
      }

      if (context.current.status === 'creating') {
        const ageMs = Date.now() - new Date(context.current.created_at).getTime()
        if (ageMs > 15 * 60 * 1000) {
          await result.supabase
            .from('platform_payment_provider_subscriptions')
            .update({
              status: 'error',
              last_error_code: 'creation_timeout',
              updated_at: new Date().toISOString(),
            })
            .eq('id', context.current.id)
            .eq('status', 'creating')
        } else {
          return errorResponse('A assinatura já está sendo preparada. Tente novamente em instantes.', 409)
        }
      } else {
        return errorResponse(
          context.current.status === 'authorized'
            ? 'A cobrança automática já está ativa.'
            : 'Existe uma assinatura que precisa ser revisada antes de criar outra.',
          409
        )
      }
    }

    const localId = randomUUID()
    const externalReference = `mav:${result.tenantUser.tenant_id}:${localId}`
    const now = new Date().toISOString()
    const { error: intentError } = await result.supabase
      .from('platform_payment_provider_subscriptions')
      .insert({
        id: localId,
        tenant_id: result.tenantUser.tenant_id,
        subscription_id: context.profile.subscription_id,
        billing_profile_id: context.profile.id,
        provider: 'mercado_pago',
        external_reference: externalReference,
        status: 'creating',
        payer_email: email,
        amount_cents: context.profile.amount_cents,
        currency: 'BRL',
        created_by_auth_user_id: result.user.id,
        created_at: now,
        updated_at: now,
      })

    if (intentError) {
      return errorResponse('Não foi possível reservar a criação da assinatura.', 409)
    }

    try {
      const provider = await createPlatformMercadoPagoSubscription({
        externalReference,
        tenantName: context.tenant.legal_name,
        payerEmail: email,
        amountCents: context.profile.amount_cents,
      })
      if (
        provider.amountCents !== context.profile.amount_cents ||
        provider.payerEmail.toLowerCase() !== email.toLowerCase()
      ) {
        throw new PlatformMercadoPagoSubscriptionError(
          'mercado_pago_subscription_identity_mismatch'
        )
      }

      const { data: saved, error: saveError } = await result.supabase
        .from('platform_payment_provider_subscriptions')
        .update({
          provider_subscription_id: provider.providerSubscriptionId,
          status: provider.status,
          checkout_url: provider.checkoutUrl,
          provider_payment_method_id: provider.paymentMethodId,
          provider_payer_id: provider.payerId,
          next_payment_at: provider.nextPaymentAt,
          authorized_at: provider.status === 'authorized' ? now : null,
          last_synced_at: now,
          last_error_code: null,
          updated_at: now,
        })
        .eq('id', localId)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('status', 'creating')
        .select('*')
        .single()

      if (saveError || !saved) {
        throw new PlatformMercadoPagoSubscriptionError(
          'subscription_persistence_failed'
        )
      }

      return Response.json({
        subscription: sanitize(
          saved as SubscriptionRow,
          context.profile.amount_cents
        ),
      })
    } catch (error) {
      const code =
        error instanceof PlatformMercadoPagoSubscriptionError
          ? error.safeCode
          : 'subscription_creation_failed'
      await result.supabase
        .from('platform_payment_provider_subscriptions')
        .update({
          status: 'error',
          last_error_code: code,
          updated_at: new Date().toISOString(),
        })
        .eq('id', localId)
        .eq('status', 'creating')

      console.error('Não foi possível criar a assinatura oficial.', code)
      return errorResponse('O Mercado Pago não conseguiu iniciar a assinatura.', 502)
    }
  } catch {
    return errorResponse('Não foi possível iniciar a assinatura da plataforma.', 500)
  }
}
