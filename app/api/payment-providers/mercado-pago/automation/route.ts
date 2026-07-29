import {
  requireTenantUser,
  tenantCanUseBilling,
} from '../../../../../src/lib/tenant-admin'
import { isMercadoPagoWebhookConfigured } from '../../../../../src/lib/payments/mercado-pago-webhook'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  if (result.tenantUser.role !== 'admin') {
    return errorResponse('Somente o administrador pode alterar a automação.', 403)
  }
  if (!tenantCanUseBilling(result.tenant)) {
    return errorResponse(
      'Cobranças disponíveis apenas em planos com cobrança mensal.',
      403
    )
  }

  const body = await request.json().catch(() => null)
  if (typeof body?.enabled !== 'boolean') {
    return errorResponse('Informe se a automação deve ser ativada.')
  }

  if (body.enabled) {
    if (!isMercadoPagoWebhookConfigured()) {
      return errorResponse(
        'Configure e valide o webhook do Mercado Pago antes de ativar o Pix dinâmico.',
        409
      )
    }

    const { data: connection, error: connectionError } = await result.supabase
      .from('tenant_payment_provider_connections')
      .select('id')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('provider', 'mercado_pago')
      .eq('status', 'connected')
      .maybeSingle()

    if (connectionError) {
      return errorResponse(
        'Não foi possível validar a conexão do Mercado Pago.',
        500,
        connectionError.message
      )
    }
    if (!connection) {
      return errorResponse('Conecte uma conta Mercado Pago antes de ativar.', 409)
    }
  }

  const now = new Date().toISOString()
  const { data, error } = await result.supabase
    .from('tenant_billing_settings')
    .update({
      payment_automation_enabled: body.enabled,
      pix_collection_mode: body.enabled ? 'provider_dynamic' : 'tenant_key',
      default_payment_provider: body.enabled ? 'mercado_pago' : null,
      updated_at: now,
    })
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select(
      'payment_automation_enabled, pix_collection_mode, default_payment_provider'
    )
    .single()

  if (error || !data) {
    return errorResponse(
      'Não foi possível atualizar a automação de pagamentos.',
      500,
      error?.message
    )
  }

  return Response.json({ settings: data })
}

