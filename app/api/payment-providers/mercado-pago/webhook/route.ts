import { createHash } from 'node:crypto'
import { createTenantAdminClient } from '../../../../../src/lib/tenant-admin'
import { getMercadoPagoPayment } from '../../../../../src/lib/payments/mercado-pago-payments'
import { getUsableMercadoPagoConnection } from '../../../../../src/lib/payments/mercado-pago-runtime'
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

  if (String(payload.type ?? '') !== 'payment' || !dataId) {
    return Response.json({ ok: true, ignored: true })
  }

  const providerAccountId = String(payload.user_id ?? '').trim()
  if (!providerAccountId) {
    return Response.json({ ok: true, ignored: true })
  }

  const supabase = createTenantAdminClient()
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
    .select('id, processing_status')
    .eq('provider', 'mercado_pago')
    .eq('provider_event_id', providerEventId)
    .maybeSingle()

  if (existingEvent?.processing_status === 'processed') {
    return Response.json({ ok: true, duplicate: true })
  }

  let eventId = existingEvent?.id
  if (!eventId) {
    const { data: insertedEvent, error: eventError } = await supabase
      .from('tenant_payment_provider_events')
      .insert({
        tenant_id: connection.tenant_id,
        connection_id: connection.id,
        provider: 'mercado_pago',
        provider_event_id: providerEventId,
        event_type: String(payload.action ?? 'payment.updated'),
        resource_type: 'payment',
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
