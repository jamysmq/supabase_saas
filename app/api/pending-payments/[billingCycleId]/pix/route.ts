import QRCode from 'qrcode'
import { requireTenantUser, tenantCanUseBilling } from '../../../../../src/lib/tenant-admin'
import {
  createStaticPixPayload,
  pixKeyTypes,
  type PixKeyType,
} from '../../../../../src/lib/payments/pix-br-code'

const allowedPixKeyTypes = new Set<string>(pixKeyTypes)

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export async function GET(
  request: Request,
  context: { params: Promise<{ billingCycleId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse('Cobranças disponíveis apenas em planos com cobrança mensal.', 403)
  }

  const { billingCycleId } = await context.params

  const [{ data: cycle, error: cycleError }, { data: settings, error: settingsError }] =
    await Promise.all([
      result.supabase
        .from('billing_cycles')
        .select(`
          id,
          due_date,
          amount_cents,
          status,
          tenant_customers!inner (
            full_name
          )
        `)
        .eq('id', billingCycleId)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('tenant_customers.tenant_id', result.tenantUser.tenant_id)
        .in('status', ['pending', 'overdue'])
        .maybeSingle(),
      result.supabase
        .from('tenant_billing_settings')
        .select('pix_key, pix_key_type, pix_beneficiary_name, pix_beneficiary_city, pix_collection_mode')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .maybeSingle(),
    ])

  if (cycleError || !cycle) {
    return errorResponse('Cobrança pendente não encontrada.', 404, cycleError?.message)
  }

  if (settingsError) {
    return errorResponse('Não foi possível carregar a configuração Pix.', 500, settingsError.message)
  }

  if (!settings || settings.pix_collection_mode !== 'tenant_key') {
    return errorResponse('O Pix manual por chave não está ativo para este estabelecimento.', 409)
  }

  const keyType = String(settings.pix_key_type ?? '')

  if (
    !settings.pix_key ||
    !settings.pix_beneficiary_name ||
    !settings.pix_beneficiary_city ||
    !allowedPixKeyTypes.has(keyType)
  ) {
    return errorResponse(
      'Complete a chave, o beneficiário e a cidade do Pix nas configurações antes de gerar o QR Code.',
      422
    )
  }

  try {
    const txid = `BILL${cycle.id.replace(/-/g, '').slice(0, 21)}`
    const payload = createStaticPixPayload({
      key: settings.pix_key,
      keyType: keyType as PixKeyType,
      merchantName: settings.pix_beneficiary_name,
      merchantCity: settings.pix_beneficiary_city,
      amountCents: cycle.amount_cents,
      txid,
    })
    const qrDataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
    })
    const customer = firstRelation(cycle.tenant_customers)

    return Response.json(
      {
        pix: {
          billing_cycle_id: cycle.id,
          customer_name: customer?.full_name ?? 'Cliente sem nome',
          due_date: cycle.due_date,
          amount_cents: cycle.amount_cents,
          beneficiary_name: settings.pix_beneficiary_name,
          beneficiary_city: settings.pix_beneficiary_city,
          txid,
          payload,
          qr_data_url: qrDataUrl,
          confirmation_mode: 'manual',
        },
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Não foi possível gerar o QR Pix.'
    return errorResponse(message, 422)
  }
}
