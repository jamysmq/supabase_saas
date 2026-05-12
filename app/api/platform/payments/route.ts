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
    .order('created_at', { ascending: false })

  if (error) {
    return Response.json(
      { error: 'Could not list platform pending payments.' },
      { status: 500 }
    )
  }

  return Response.json({ payments: data ?? [] })
}
