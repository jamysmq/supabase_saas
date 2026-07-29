import {
  requireTenantUser,
  tenantCanUseBilling,
} from '../../../../src/lib/tenant-admin'
import { getMercadoPagoPayment } from '../../../../src/lib/payments/mercado-pago-payments'
import { getUsableMercadoPagoConnection } from '../../../../src/lib/payments/mercado-pago-runtime'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Recurso indisponível para este plano.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_payment_provider_charges')
    .select(`
      id,
      billing_cycle_id,
      provider,
      provider_charge_id,
      status,
      amount_cents,
      provider_status,
      provider_status_detail,
      reconciliation_status,
      divergence_reason,
      last_reconciled_at,
      updated_at
    `)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .in('reconciliation_status', ['pending', 'divergent'])
    .order('updated_at', { ascending: false })
    .limit(100)

  if (error) {
    return errorResponse(
      'Não foi possível carregar a fila de conciliação.',
      500,
      error.message
    )
  }

  return Response.json(
    { items: data ?? [] },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Recurso indisponível para este plano.', 403)
  }

  const body = await request.json().catch(() => null)
  const chargeId = String(body?.charge_id ?? '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(chargeId)) {
    return errorResponse('Cobrança inválida.')
  }

  const tenantId = result.tenantUser.tenant_id
  const { data: charge, error: chargeError } = await result.supabase
    .from('tenant_payment_provider_charges')
    .select('id, provider, provider_charge_id, external_reference')
    .eq('id', chargeId)
    .eq('tenant_id', tenantId)
    .eq('provider', 'mercado_pago')
    .maybeSingle()

  if (chargeError || !charge) {
    return errorResponse('Cobrança não encontrada.', 404, chargeError?.message)
  }

  try {
    const connection = await getUsableMercadoPagoConnection(
      result.supabase,
      tenantId
    )
    const payment = await getMercadoPagoPayment(
      connection.credentials,
      charge.provider_charge_id
    )

    if (payment.externalReference !== charge.external_reference) {
      return errorResponse(
        'A referência retornada pelo Mercado Pago diverge da cobrança local.',
        409
      )
    }

    const { data, error } = await result.supabase.rpc(
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
        p_event_id: null,
      }
    )

    if (error) throw error
    return Response.json({ reconciliation: data?.[0] ?? null })
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : 'Não foi possível consultar o Mercado Pago.',
      502
    )
  }
}

