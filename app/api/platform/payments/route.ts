import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase
    .from('payments')
    .select(`
      id,
      tenant_id,
      subscription_id,
      provider,
      asaas_payment_id,
      amount_cents,
      billing_type,
      status,
      payload,
      created_at,
      confirmed_at,
      deleted_at,
      tenants (
        legal_name,
        email,
        cpf,
        whatsapp_e164,
        business_type,
        plan
      )
    `)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json(
      { error: 'Não foi possível listar os pagamentos pendentes da plataforma.' },
      { status: 500 }
    )
  }

  return Response.json({ payments: data ?? [] })
}
