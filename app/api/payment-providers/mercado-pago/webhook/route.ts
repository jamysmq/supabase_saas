import { createHash } from 'node:crypto'
import { createTenantAdminClient } from '../../../../../src/lib/tenant-admin'
import { getMercadoPagoPayment } from '../../../../../src/lib/payments/mercado-pago-payments'
import { getUsableMercadoPagoConnection } from '../../../../../src/lib/payments/mercado-pago-runtime'
import { handlePlatformMercadoPagoWebhook } from '../../../../../src/lib/payments/platform-mercado-pago-webhook'
import {
  isMercadoPagoWebhookConfigured,
  validateMercadoPagoWebhookSignature,
} from '../../../../../src/lib/payments/mercado-pago-webhook'

export const runtime = 'nodejs'

type WebhookPayload = {
  id?: unknown
  type?: unknown
  action?: unknown
  user_id?: unknown
  date_created?: unknown
  live_mode?: unknown
  data?: { id?: unknown } | null
}

function safeEventId(payload: WebhookPayload, requestId: string, rawBody: string) {
  const notificationId = String(payload.id ?? '').trim()
  if (notificationId) return notificationId
  if (requestId) return requestId
  return createHash('sha256').update(rawBody).digest('hex')
}

export async function POST(request: Request) {
  if (!isMercadoPagoWebhookConfigured()) {
    return Response.json({ error: 'Webhook unavailable.' }, { status: 503 })
  }

  const rawBody = await request.text()
  if (Buffer.byteLength(rawBody, 'utf8') > 128 * 1024) {
    return Response.json({ error: 'Payload too large.' }, { status: 413 })
  }

  let payload: WebhookPayload
  try {
    payload = JSON.parse(rawBody) as WebhookPayload
  } catch {
    return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const url = new URL(request.url)
  const dataId = String(
    url.searchParams.get('data.id') ??
      url.searchParams.get('data_id') ??
      payload.data?.id ??
      ''
  ).trim()
  const requestId = request.headers.get('x-request-id')?.trim() ?? ''

  if (
    !validateMercadoPagoWebhookSignature({
      xSignature: request.headers.get('x-signature'),
      xRequestId: requestId,
      dataId,
    })
  ) {
    return Response.json({ error: 'Invalid signature.' }, { status: 401 })
  }

  const notificationType = String(payload.type ?? '')
  if (
    notificationType !== 'payment' &&
    notificationType !== 'mp-connect' &&
    notificationType !== 'subscription_preapproval' &&
    notificationType !== 'subscription_authorized_payment'
  ) {
    return Response.json({ ok: true, ignored: true })
  }

  const providerAccountId = String(payload.user_id ?? '').trim()
  if (!dataId || !providerAccountId) {
    return Response.json({ ok: true, ignored: true })
  }

  const supabase = createTenantAdminClient()
  if (notificationType !== 'mp-connect') {
    const platformResponse = await handlePlatformMercadoPagoWebhook({
      supabase,
      payload,
      notificationType,
      dataId,
      providerAccountId,
      providerEventId: `${providerAccountId}:${notificationType}:${safeEventId(
        payload,
        requestId,
        rawBody
      )}`,
    })

    if (platformResponse instanceof Response) return platformResponse
  }

  if (
    notificationType === 'subscription_preapproval' ||
    notificationType === 'subscription_authorized_payment'
  ) {
    return Response.json({ ok: true, ignored: true })
  }

  const { data: connection, error: connectionError } = await supabase
    .from('tenant_payment_provider_connections')
    .select('id, tenant_id, status')
    .eq('provider', 'mercado_pago')
    .eq('provider_account_id', providerAccountId)
    .maybeSingle()

  if (connectionError) {
    return Response.json({ error: 'Connection lookup failed.' }, { status: 500 })
  }
  if (!connection) {
    return Response.json({ ok: true, ignored: true })
  }

  const providerEventId = `${providerAccountId}:${safeEventId(
    payload,
    requestId,
    rawBody
  )}`
  const { data: existingEvent } = await supabase
    .from('tenant_payment_provider_events')
    .select('id, processing_status, processing_attempts')
    .eq('provider', 'mercado_pago')
    .eq('provider_event_id', providerEventId)
    .maybeSingle()

  if (existingEvent?.processing_status === 'processed') {
    return Response.json({ ok: true, duplicate: true })
  }

  let eventId = existingEvent?.id
  const eventAttempts = existingEvent?.processing_attempts ?? 0
  if (!eventId) {
    const { data: insertedEvent, error: eventError } = await supabase
      .from('tenant_payment_provider_events')
      .insert({
        tenant_id: connection.tenant_id,
        connection_id: connection.id,
        provider: 'mercado_pago',
        provider_event_id: providerEventId,
        event_type: String(
          payload.action ??
            (notificationType === 'mp-connect'
              ? 'application.updated'
              : 'payment.updated')
        ),
        resource_type:
          notificationType === 'mp-connect' ? 'oauth_connection' : 'payment',
        provider_resource_id: dataId,
        processing_status: 'received',
        payload,
      })
      .select('id')
      .single()

    if (eventError || !insertedEvent) {
      if (eventError?.code === '23505') {
        return Response.json({ ok: true, duplicate: true })
      }
      return Response.json({ error: 'Event persistence failed.' }, { status: 500 })
    }
    eventId = insertedEvent.id
  }

  if (notificationType === 'mp-connect') {
    const action = String(payload.action ?? 'application.updated')
    const processedAt = new Date().toISOString()

    try {
      if (action === 'application.deauthorized') {
        const {
          data: updatedConnection,
          error: connectionUpdateError,
        } = await supabase
          .from('tenant_payment_provider_connections')
          .update({
            status: 'needs_reauthorization',
            credentials_ciphertext: null,
            granted_scopes: [],
            capabilities: {},
            token_expires_at: null,
            disconnected_at: processedAt,
            updated_at: processedAt,
            last_error_code: 'mercado_pago_application_deauthorized',
          })
          .eq('id', connection.id)
          .eq('tenant_id', connection.tenant_id)
          .eq('provider', 'mercado_pago')
          .select('id')
          .maybeSingle()

        if (connectionUpdateError || !updatedConnection) {
          throw connectionUpdateError ?? new Error('Connection update failed.')
        }

        const { data: updatedSettings, error: settingsUpdateError } =
          await supabase
          .from('tenant_billing_settings')
          .update({
            payment_automation_enabled: false,
            pix_collection_mode: 'tenant_key',
            default_payment_provider: null,
            updated_at: processedAt,
          })
          .eq('tenant_id', connection.tenant_id)
          .select('tenant_id')
          .maybeSingle()

        if (settingsUpdateError || !updatedSettings) {
          throw settingsUpdateError ?? new Error('Billing settings update failed.')
        }
      }

      const { error: processedEventError } = await supabase
        .from('tenant_payment_provider_events')
        .update({
          processing_status: 'processed',
          processing_attempts: eventAttempts + 1,
          error_code: null,
          error_message: null,
          processed_at: processedAt,
        })
        .eq('id', eventId)
        .eq('tenant_id', connection.tenant_id)
        .eq('connection_id', connection.id)
        .eq('provider', 'mercado_pago')

      if (processedEventError) throw processedEventError

      return Response.json({
        ok: true,
        handled: true,
        type: 'mp-connect',
        action,
      })
    } catch {
      const { error: failedEventError } = await supabase
        .from('tenant_payment_provider_events')
        .update({
          processing_status: 'failed',
          processing_attempts: eventAttempts + 1,
          error_code: 'connection_event_processing_failed',
          error_message: 'Mercado Pago connection event processing failed.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventId)
        .eq('tenant_id', connection.tenant_id)
        .eq('connection_id', connection.id)
        .eq('provider', 'mercado_pago')

      if (failedEventError) {
        return Response.json(
          { error: 'Connection event processing failed.' },
          { status: 500 }
        )
      }

      return Response.json(
        { error: 'Connection event processing failed.' },
        { status: 500 }
      )
    }
  }

  try {
    const runtimeConnection = await getUsableMercadoPagoConnection(
      supabase,
      connection.tenant_id
    )
    const payment = await getMercadoPagoPayment(
      runtimeConnection.credentials,
      dataId
    )

    const { data: charge, error: chargeError } = await supabase
      .from('tenant_payment_provider_charges')
      .select('id, external_reference')
      .eq('tenant_id', connection.tenant_id)
      .eq('connection_id', connection.id)
      .eq('provider', 'mercado_pago')
      .eq('provider_charge_id', payment.providerChargeId)
      .maybeSingle()

    if (chargeError) throw chargeError
    if (!charge) {
      await supabase
        .from('tenant_payment_provider_events')
        .update({
          processing_status: 'failed',
          processing_attempts: 1,
          error_code: 'charge_not_found',
          error_message: 'Cobrança local ainda não encontrada.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventId)
      return Response.json({ error: 'Charge not ready.' }, { status: 500 })
    }

    if (charge.external_reference !== payment.externalReference) {
      await supabase
        .from('tenant_payment_provider_events')
        .update({
          charge_id: charge.id,
          processing_status: 'failed',
          processing_attempts: 1,
          error_code: 'external_reference_mismatch',
          error_message: 'Referência externa divergente.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', eventId)
      return Response.json({ ok: true, divergent: true })
    }

    const { error: reconcileError } = await supabase.rpc(
      'admin_reconcile_mercado_pago_payment',
      {
        p_charge_id: charge.id,
        p_provider_status: payment.providerStatus,
        p_status_detail: payment.providerStatusDetail,
        p_amount_cents: payment.amountCents,
        p_fee_cents: payment.feeCents ?? null,
        p_net_amount_cents: payment.netAmountCents ?? null,
        p_paid_at: payment.paidAt ?? null,
        p_provider_payload: payment.providerPayload,
        p_event_id: eventId,
      }
    )

    if (reconcileError) throw reconcileError
    return Response.json({ ok: true })
  } catch (error) {
    await supabase
      .from('tenant_payment_provider_events')
      .update({
        processing_status: 'failed',
        processing_attempts: 1,
        error_code: 'processing_failed',
        error_message:
          error instanceof Error ? error.message.slice(0, 500) : 'Unknown error.',
        processed_at: new Date().toISOString(),
      })
      .eq('id', eventId)

    return Response.json({ error: 'Processing failed.' }, { status: 500 })
  }
}
