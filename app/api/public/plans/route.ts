import { createSupabaseAdminClient } from '../../../../src/lib/platform-admin'

export async function GET() {
  const supabase = createSupabaseAdminClient()

  const { data, error } = await supabase
    .from('platform_plans')
    .select('code, name, description, monthly_amount_cents, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    return Response.json(
      { error: 'Nao foi possivel carregar os planos.' },
      { status: 500 }
    )
  }

  return Response.json({ plans: data ?? [] })
}
