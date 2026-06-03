import { requirePlatformAdmin } from '../../../../../../src/lib/platform-admin'
import {
  createPlatformTenant,
  PlatformTenantCreationError,
} from '../../../../../../src/services/platform-tenants'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function asPayloadRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export async function POST(
  request: Request,
  context: { params: Promise<{ paymentId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { paymentId } = await context.params
  const body = await request.json().catch(() => null)
  const note = typeof body?.note === 'string' ? body.note.trim() : ''

  const { data: publicPayment, error: publicPaymentError } = await result.supabase
    .from('payments')
    .select('id, tenant_id, amount_cents, status, payload')
    .eq('id', paymentId)
    .eq('billing_type', 'public_signup_request')
    .maybeSingle()

  if (publicPaymentError) {
    return errorResponse(
      'Nao foi possivel carregar a solicitacao publica.',
      500,
      publicPaymentError.message
    )
  }

  if (publicPayment) {
    if (publicPayment.tenant_id) {
      const { data: existingTenant } = await result.supabase
        .from('tenants')
        .select('id')
        .eq('id', publicPayment.tenant_id)
        .maybeSingle()

      if (existingTenant) {
        return Response.json({ ok: true, tenant_id: existingTenant.id })
      }
    }

    const payload = asPayloadRecord(publicPayment.payload)

    let createdTenant

    try {
      const created = await createPlatformTenant(result.supabase, {
        legal_name: payload.legal_name,
        cpf: payload.cpf,
        email: payload.email,
        birth_date: payload.birth_date,
        whatsapp_e164: payload.whatsapp_e164,
        plan: payload.plan,
        admin_email: payload.admin_email,
        business_type: payload.business_type,
        status: 'active',
        monthly_amount_cents: payload.amount_cents ?? publicPayment.amount_cents,
        due_day: payload.due_day,
      })
      createdTenant = created.tenant
    } catch (error) {
      if (error instanceof PlatformTenantCreationError) {
        return errorResponse(error.message, error.status, error.details)
      }

      return errorResponse('Nao foi possivel criar o tenant da solicitacao publica.', 500)
    }

    const { error: updateError } = await result.supabase
      .from('payments')
      .update({
        tenant_id: createdTenant.id,
        status: 'paid',
        confirmed_source: 'platform_signup_panel',
        confirmed_note: note || 'Solicitacao publica aprovada pelo painel da plataforma',
        payload: {
          ...payload,
          tenant_status: 'active',
          created_tenant_id: createdTenant.id,
          approved_at: new Date().toISOString(),
        },
      })
      .eq('id', paymentId)

    if (updateError) {
      return errorResponse(
        'Nao foi possivel aprovar a solicitacao publica.',
        500,
        updateError.message
      )
    }

    return Response.json({ ok: true, tenant_id: createdTenant.id })
  }

  const { error } = await result.supabase.rpc(
    'admin_confirm_signup_payment',
    {
      p_payment_id: paymentId,
      p_note: note || 'Confirmado pelo painel da plataforma',
    }
  )

  if (error) {
    return errorResponse('Nao foi possivel confirmar o pagamento do cadastro.', 500, error.message)
  }

  return Response.json({ ok: true })
}
