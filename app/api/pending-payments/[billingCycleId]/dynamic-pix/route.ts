import { createHash } from 'node:crypto'
import QRCode from 'qrcode'
import {
  requireTenantUser,
  tenantCanUseBilling,
} from '../../../../../src/lib/tenant-admin'
import { getUsableMercadoPagoConnection } from '../../../../../src/lib/payments/mercado-pago-runtime'
import { createMercadoPagoPixPayment } from '../../../../../src/lib/payments/mercado-pago-payments'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(createHash('sha256').update(value).digest().subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function createQrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 360,
  })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ billingCycleId: string }> }
) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse(
      'Cobranças disponíveis apenas em planos com cobrança mensal.',
      403
    )
  }

  const { billingCycleId } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(billingCycleId)) {
    return errorResponse('Cobrança inválida.', 400)
  }

  const tenantId = result.tenantUser.tenant_id
  const [{ data: cycle, error: cycleError }, { data: settings, error: settingsError }] =
    await Promise.all([
      result.supabase
        .from('billing_cycles')
        .select(`
          id,
          tenant_id,
          customer_id,
          due_date,
          amount_cents,
          status,
          tenant_customers!inner (
            full_name,
            email,
            cpf,
            phone_e164
          )
        `)
        .eq('id', billingCycleId)
        .eq('tenant_id', tenantId)
        .eq('tenant_customers.tenant_id', tenantId)
        .in('status', ['pending', 'overdue'])
        .maybeSingle(),
      result.supabase
        .from('tenant_billing_settings')
        .select(
          'payment_automation_enabled, pix_collection_mode, default_payment_provider'
        )
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ])

  if (cycleError || !cycle) {
    return errorResponse(
      'Cobrança pendente não encontrada.',
      404,
      cycleError?.message
    )
  }

  if (settingsError) {
    return errorResponse(
      'Não foi possível carregar a configuração de pagamento.',
      500,
      settingsError.message
    )
  }

  if (
    !settings?.payment_automation_enabled ||
    settings.pix_collection_mode !== 'provider_dynamic' ||
    settings.default_payment_provider !== 'mercado_pago'
  ) {
    return errorResponse(
      'O Pix dinâmico ainda não está ativo para este estabelecimento.',
      409
    )
  }

  const customer = firstRelation(cycle.tenant_customers)
  if (!customer?.email) {
    return errorResponse(
      'Cadastre o e-mail do cliente antes de gerar um Pix dinâmico.',
      422
    )
  }

  let connection
  try {
    connection = await getUsableMercadoPagoConnection(
      result.supabase,
      tenantId
    )
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : 'A conexão com o Mercado Pago está indisponível.',
      409
    )
  }

  const { data: previousCharges, error: previousError } = await result.supabase
    .from('tenant_payment_provider_charges')
    .select(
      'id, attempt_number, status, reconciliation_status, divergence_reason, pix_copy_paste, pix_expires_at, checkout_url, provider_charge_id'
    )
    .eq('tenant_id', tenantId)
    .eq('connection_id', connection.id)
    .eq('billing_cycle_id', cycle.id)
    .eq('payment_method', 'pix')
    .order('attempt_number', { ascending: false })
    .limit(1)

  if (previousError) {
    return errorResponse(
      'Não foi possível verificar a cobrança Pix existente.',
      500,
      previousError.message
    )
  }

  const previous = previousCharges?.[0]
  if (previous?.status === 'paid') {
    return errorResponse(
      'Este Pix já consta como pago. Atualize a lista antes de gerar outra cobrança.',
      409
    )
  }
  if (previous?.reconciliation_status === 'divergent') {
    return errorResponse(
      'Esta cobrança está na fila de conciliação e precisa ser conferida antes de gerar outro Pix.',
      409
    )
  }
  const previousStillValid =
    previous?.status === 'pending' &&
    previous.pix_copy_paste &&
    previous.pix_expires_at &&
    new Date(previous.pix_expires_at).getTime() > Date.now()

  if (previousStillValid) {
    return Response.json(
      {
        pix: {
          billing_cycle_id: cycle.id,
          customer_name: customer.full_name,
          due_date: cycle.due_date,
          amount_cents: cycle.amount_cents,
          beneficiary_name:
            result.tenant.public_name ?? result.tenant.legal_name,
          txid: previous.provider_charge_id,
          payload: previous.pix_copy_paste,
          qr_data_url: await createQrDataUrl(previous.pix_copy_paste),
          checkout_url: previous.checkout_url,
          expires_at: previous.pix_expires_at,
          confirmation_mode: 'automatic',
          provider: 'mercado_pago',
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  }

  const attemptNumber = (previous?.attempt_number ?? 0) + 1
  const idempotencyKey = deterministicUuid(`${cycle.id}:pix:${attemptNumber}`)
  const externalReference = `billing:${cycle.id}:pix:${attemptNumber}`

  try {
    const payment = await createMercadoPagoPixPayment(
      connection.credentials,
      {
        tenantId,
        connectionId: connection.id,
        billingCycleId: cycle.id,
        customerId: cycle.customer_id,
        externalReference,
        paymentMethod: 'pix',
        amountCents: cycle.amount_cents,
        dueDate: cycle.due_date,
        description: `Mensalidade de ${customer.full_name}`,
        payer: {
          name: customer.full_name,
          email: customer.email,
          cpf: customer.cpf ?? undefined,
          whatsappE164: customer.phone_e164,
        },
      },
      idempotencyKey
    )

    if (!payment.pixCopyPaste) {
      return errorResponse(
        'O Mercado Pago não retornou o código Pix. Tente novamente.',
        502
      )
    }

    const { data: savedCharge, error: saveError } = await result.supabase
      .from('tenant_payment_provider_charges')
      .upsert(
        {
          tenant_id: tenantId,
          connection_id: connection.id,
          billing_cycle_id: cycle.id,
          customer_id: cycle.customer_id,
          provider: 'mercado_pago',
          provider_charge_id: payment.providerChargeId,
          external_reference: payment.externalReference,
          payment_method: 'pix',
          status: payment.status,
          amount_cents: payment.amountCents,
          fee_cents: payment.feeCents ?? null,
          net_amount_cents: payment.netAmountCents ?? null,
          checkout_url: payment.checkoutUrl ?? null,
          pix_copy_paste: payment.pixCopyPaste,
          pix_expires_at: payment.pixExpiresAt ?? null,
          due_date: cycle.due_date,
          paid_at: payment.paidAt ?? null,
          provider_payload: payment.providerPayload,
          attempt_number: attemptNumber,
          idempotency_key: idempotencyKey,
          provider_status: payment.providerStatus,
          provider_status_detail: payment.providerStatusDetail || null,
          reconciliation_status: 'pending',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'connection_id,provider_charge_id' }
      )
      .select('id')
      .single()

    if (saveError || !savedCharge) {
      return errorResponse(
        'O Pix foi criado, mas não pôde ser registrado. Tente novamente para recuperar a mesma cobrança.',
        500,
        saveError?.message
      )
    }

    const { error: reconcileError } = await result.supabase.rpc(
      'admin_reconcile_mercado_pago_payment',
      {
        p_charge_id: savedCharge.id,
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

    if (reconcileError) {
      return errorResponse(
        'O Pix foi criado, mas a conferência inicial ficou pendente.',
        500,
        reconcileError.message
      )
    }

    return Response.json(
      {
        pix: {
          billing_cycle_id: cycle.id,
          customer_name: customer.full_name,
          due_date: cycle.due_date,
          amount_cents: cycle.amount_cents,
          beneficiary_name:
            result.tenant.public_name ?? result.tenant.legal_name,
          txid: payment.providerChargeId,
          payload: payment.pixCopyPaste,
          qr_data_url: await createQrDataUrl(payment.pixCopyPaste),
          checkout_url: payment.checkoutUrl,
          expires_at: payment.pixExpiresAt,
          confirmation_mode: 'automatic',
          provider: 'mercado_pago',
        },
      },
      {
        status: 201,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    )
  } catch (error) {
    return errorResponse(
      error instanceof Error
        ? error.message
        : 'Não foi possível gerar o Pix pelo Mercado Pago.',
      502
    )
  }
}
