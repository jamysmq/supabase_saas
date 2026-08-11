import 'server-only'

import type { createTenantAdminClient } from '../tenant-admin'
import {
  getPlatformMercadoPagoAuthorizedPayment,
  getPlatformMercadoPagoRecurringPayment,
  getPlatformMercadoPagoSubscription,
  PlatformMercadoPagoSubscriptionError,
} from './platform-mercado-pago-subscriptions'

type SupabaseAdminClient = ReturnType<typeof createTenantAdminClient>

type PlatformWebhookPayload = {
  action?: unknown
  live_mode?: unknown
  type?: unknown
  user_id?: unknown
  data?: { id?: unknown } | null
}

type PlatformSubscriptionRow = {
  id: string
  tenant_id: string
  external_reference: string
  provider_subscription_id: string | null
  payer_email: string
  amount_cents: number
  currency: string
  authorized_at: string | null
}

const supportedTypes = new Set([
  'subscription_preapproval',
  'subscription_authorized_payment',
  'payment',
])

function safeErrorCode(error: unknown) {
  return error instanceof PlatformMercadoPagoSubscriptionError
    ? error.safeCode
    : 'platform_subscription_processing_failed'
}

async function markEventFailed(
  supabase: SupabaseAdminClient,
  eventId: string,
  attempts: number,
  error: unknown
) {
  await supabase
    .from('platform_payment_provider_events')
    .update({
      processing_status: 'failed',
      processing_attempts: attempts + 1,
      error_code: safeErrorCode(error),
      error_message: 'Platform subscription event processing failed.',
      processed_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('provider', 'mercado_pago')
}

async function markEventProcessed(
  supabase: SupabaseAdminClient,
  eventId: string,
  subscriptionRowId: string,
  attempts: number
) {
  const { error } = await supabase
    .from('platform_payment_provider_events')
    .update({
      provider_subscription_row_id: subscriptionRowId,
      processing_status: 'processed',
      processing_attempts: attempts + 1,
      error_code: null,
      error_message: null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('provider', 'mercado_pago')

  if (error) throw error
}

async function markEventIgnored(
  supabase: SupabaseAdminClient,
  eventId: string,
  subscription: PlatformSubscriptionRow | null,
  attempts: number
) {
  const { error } = await supabase
    .from('platform_payment_provider_events')
    .update({
      provider_subscription_row_id: subscription?.id ?? null,
      processing_status: 'processed',
      processing_attempts: attempts + 1,
      error_code: null,
      error_message: null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', eventId)
    .eq('provider', 'mercado_pago')

  if (error) throw error
}

async function findSubscriptionByProviderId(
  supabase: SupabaseAdminClient,
  providerSubscriptionId: string
) {
  const { data, error } = await supabase
    .from('platform_payment_provider_subscriptions')
    .select('id, tenant_id, external_reference, provider_subscription_id, payer_email, amount_cents, currency, authorized_at')
    .eq('provider', 'mercado_pago')
    .eq('provider_subscription_id', providerSubscriptionId)
    .maybeSingle()

  if (error) throw error
  return data as PlatformSubscriptionRow | null
}

async function findSubscriptionByExternalReference(
  supabase: SupabaseAdminClient,
  externalReference: string
) {
  const { data, error } = await supabase
    .from('platform_payment_provider_subscriptions')
    .select('id, tenant_id, external_reference, provider_subscription_id, payer_email, amount_cents, currency, authorized_at')
    .eq('provider', 'mercado_pago')
    .eq('external_reference', externalReference)
    .maybeSingle()

  if (error) throw error
  return data as PlatformSubscriptionRow | null
}

function validateSubscriptionIdentity(
  row: PlatformSubscriptionRow | null,
  provider: {
    externalReference: string
    amountCents: number
    currency: string
  }
) {
  if (!row) {
    throw new PlatformMercadoPagoSubscriptionError(
      'platform_subscription_not_found'
    )
  }
  if (
    row.external_reference !== provider.externalReference ||
    row.amount_cents !== provider.amountCents ||
    row.currency !== provider.currency
  ) {
    throw new PlatformMercadoPagoSubscriptionError(
      'mercado_pago_subscription_identity_mismatch'
    )
  }
  return row
}

function isPlatformExternalReference(externalReference: string) {
  return externalReference.startsWith('mav:') || externalReference.startsWith('jack:')
}

function shouldIgnoreUnknownSubscription(
  row: PlatformSubscriptionRow | null,
  externalReference: string
) {
  return (
    !isPlatformExternalReference(externalReference) &&
    (!row || !isPlatformExternalReference(row.external_reference))
  )
}

function ignoredResponse(notificationType: string) {
  return Response.json({
    ok: true,
    ignored: true,
    scope: 'platform',
    type: notificationType,
  })
}

async function reconcilePayment(input: {
  supabase: SupabaseAdminClient
  subscription: PlatformSubscriptionRow
  eventId: string
  invoiceId: string | null
  paymentId: string | null
  providerStatus: string
  statusDetail: string | null
  amountCents: number
  currency: string
  dueAt: string | null
  feeCents: number | null
  netAmountCents: number | null
  paidAt: string | null
  refundedAt: string | null
  providerPayload: Record<string, unknown>
}) {
  const { error } = await input.supabase.rpc(
    'admin_reconcile_platform_mercado_pago_payment',
    {
      p_subscription_row_id: input.subscription.id,
      p_provider_event_row_id: input.eventId,
      p_provider_invoice_id: input.invoiceId,
      p_provider_payment_id: input.paymentId,
      p_provider_status: input.providerStatus,
      p_provider_status_detail: input.statusDetail,
      p_amount_cents: input.amountCents,
      p_currency: input.currency,
      p_due_at: input.dueAt,
      p_fee_cents: input.feeCents,
      p_net_amount_cents: input.netAmountCents,
      p_paid_at: input.paidAt,
      p_refunded_at: input.refundedAt,
      p_provider_payload: input.providerPayload,
    }
  )

  if (error) throw error
}

export async function handlePlatformMercadoPagoWebhook(input: {
  supabase: SupabaseAdminClient
  payload: PlatformWebhookPayload
  notificationType: string
  dataId: string
  providerAccountId: string
  providerEventId: string
}) {
  if (!supportedTypes.has(input.notificationType)) {
    return null
  }

  const { data: account, error: accountError } = await input.supabase
    .from('platform_payment_provider_accounts')
    .select('provider, status, provider_account_id')
    .eq('provider', 'mercado_pago')
    .eq('provider_account_id', input.providerAccountId)
    .maybeSingle()

  if (accountError) {
    return Response.json({ error: 'Platform account lookup failed.' }, { status: 500 })
  }
  if (!account) return null

  const { data: existingEvent, error: existingError } = await input.supabase
    .from('platform_payment_provider_events')
    .select('id, processing_status, processing_attempts')
    .eq('provider', 'mercado_pago')
    .eq('provider_event_id', input.providerEventId)
    .maybeSingle()

  if (existingError) {
    return Response.json({ error: 'Platform event lookup failed.' }, { status: 500 })
  }
  if (existingEvent?.processing_status === 'processed') {
    return Response.json({ ok: true, duplicate: true, scope: 'platform' })
  }

  let eventId = existingEvent?.id as string | undefined
  const attempts = existingEvent?.processing_attempts ?? 0
  if (!eventId) {
    const resourceType =
      input.notificationType === 'subscription_preapproval'
        ? 'subscription'
        : input.notificationType === 'subscription_authorized_payment'
          ? 'authorized_payment'
          : 'payment'
    const { data: inserted, error: insertError } = await input.supabase
      .from('platform_payment_provider_events')
      .insert({
        provider: 'mercado_pago',
        provider_event_id: input.providerEventId,
        event_type: String(input.payload.action ?? `${input.notificationType}.updated`),
        resource_type: resourceType,
        provider_resource_id: input.dataId,
        processing_status: 'received',
        payload: input.payload,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      if (insertError?.code === '23505') {
        return Response.json({ ok: true, duplicate: true, scope: 'platform' })
      }
      return Response.json({ error: 'Platform event persistence failed.' }, { status: 500 })
    }
    eventId = inserted.id
  }

  if (!eventId) {
    return Response.json({ error: 'Platform event persistence failed.' }, { status: 500 })
  }

  try {
    if (input.notificationType === 'subscription_preapproval') {
      const provider = await getPlatformMercadoPagoSubscription(input.dataId)
      const localSubscription = await findSubscriptionByProviderId(
        input.supabase,
        provider.providerSubscriptionId
      )

      if (
        shouldIgnoreUnknownSubscription(
          localSubscription,
          provider.externalReference
        )
      ) {
        await markEventIgnored(
          input.supabase,
          eventId,
          localSubscription,
          attempts
        )
        return ignoredResponse(input.notificationType)
      }

      const subscription = validateSubscriptionIdentity(
        localSubscription,
        provider
      )

      if (subscription.payer_email.toLowerCase() !== provider.payerEmail.toLowerCase()) {
        throw new PlatformMercadoPagoSubscriptionError(
          'mercado_pago_subscription_identity_mismatch'
        )
      }

      const now = new Date().toISOString()
      const { error: updateError } = await input.supabase
        .from('platform_payment_provider_subscriptions')
        .update({
          status: provider.status,
          checkout_url: provider.checkoutUrl,
          provider_payment_method_id: provider.paymentMethodId,
          provider_payer_id: provider.payerId,
          next_payment_at: provider.nextPaymentAt,
          authorized_at:
            provider.status === 'authorized'
              ? subscription.authorized_at ?? now
              : subscription.authorized_at,
          cancelled_at: provider.status === 'cancelled' ? now : null,
          last_synced_at: now,
          last_error_code: null,
          updated_at: now,
        })
        .eq('id', subscription.id)
        .eq('provider', 'mercado_pago')

      if (updateError) throw updateError
      await markEventProcessed(input.supabase, eventId, subscription.id, attempts)
      return Response.json({ ok: true, scope: 'platform', type: input.notificationType })
    }

    if (input.notificationType === 'subscription_authorized_payment') {
      const invoice = await getPlatformMercadoPagoAuthorizedPayment(input.dataId)
      const localSubscription = await findSubscriptionByProviderId(
        input.supabase,
        invoice.preapprovalId
      )

      if (
        shouldIgnoreUnknownSubscription(
          localSubscription,
          invoice.externalReference
        )
      ) {
        await markEventIgnored(
          input.supabase,
          eventId,
          localSubscription,
          attempts
        )
        return ignoredResponse(input.notificationType)
      }

      const subscription = validateSubscriptionIdentity(
        localSubscription,
        invoice
      )
      const payment = invoice.payment
        ? await getPlatformMercadoPagoRecurringPayment(invoice.payment.id)
        : null

      if (
        payment &&
        (payment.externalReference !== subscription.external_reference ||
          payment.amountCents !== subscription.amount_cents ||
          payment.currency !== subscription.currency)
      ) {
        throw new PlatformMercadoPagoSubscriptionError(
          'mercado_pago_subscription_identity_mismatch'
        )
      }

      await reconcilePayment({
        supabase: input.supabase,
        subscription,
        eventId,
        invoiceId: invoice.invoiceId,
        paymentId: payment?.paymentId ?? null,
        providerStatus: payment?.status ?? invoice.status,
        statusDetail: payment?.statusDetail ?? invoice.summarized,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        dueAt: invoice.debitDate,
        feeCents: payment?.feeCents ?? null,
        netAmountCents: payment?.netReceivedAmountCents ?? null,
        paidAt: payment?.dateApproved ?? null,
        refundedAt:
          payment && payment.refundedAmountCents > 0
            ? payment.dateLastUpdated ?? new Date().toISOString()
            : null,
        providerPayload: {
          invoiceId: invoice.invoiceId,
          invoiceStatus: invoice.status,
          summarized: invoice.summarized,
          paymentId: payment?.paymentId ?? null,
          paymentStatus: payment?.status ?? null,
          paymentStatusDetail: payment?.statusDetail ?? null,
          paymentMethodId: payment?.paymentMethodId ?? null,
        },
      })
      return Response.json({ ok: true, scope: 'platform', type: input.notificationType })
    }

    const payment = await getPlatformMercadoPagoRecurringPayment(input.dataId)
    const localSubscription = await findSubscriptionByExternalReference(
      input.supabase,
      payment.externalReference
    )

    if (
      shouldIgnoreUnknownSubscription(
        localSubscription,
        payment.externalReference
      )
    ) {
      await markEventIgnored(
        input.supabase,
        eventId,
        localSubscription,
        attempts
      )
      return ignoredResponse(input.notificationType)
    }

    const subscription = validateSubscriptionIdentity(
      localSubscription,
      payment
    )

    await reconcilePayment({
      supabase: input.supabase,
      subscription,
      eventId,
      invoiceId: null,
      paymentId: payment.paymentId,
      providerStatus: payment.status,
      statusDetail: payment.statusDetail,
      amountCents: payment.amountCents,
      currency: payment.currency,
      dueAt: payment.dateCreated,
      feeCents: payment.feeCents,
      netAmountCents: payment.netReceivedAmountCents,
      paidAt: payment.dateApproved,
      refundedAt:
        payment.refundedAmountCents > 0
          ? payment.dateLastUpdated ?? new Date().toISOString()
          : null,
      providerPayload: {
        paymentId: payment.paymentId,
        paymentStatus: payment.status,
        paymentStatusDetail: payment.statusDetail,
        paymentMethodId: payment.paymentMethodId,
        refundedAmountCents: payment.refundedAmountCents,
      },
    })
    return Response.json({ ok: true, scope: 'platform', type: input.notificationType })
  } catch (error) {
    await markEventFailed(input.supabase, eventId, attempts, error)
    console.error('Platform Mercado Pago webhook processing failed.', safeErrorCode(error))
    return Response.json({ error: 'Platform event processing failed.' }, { status: 500 })
  }
}
