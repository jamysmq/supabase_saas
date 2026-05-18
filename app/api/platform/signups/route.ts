import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase.rpc(
    'admin_list_pending_signups'
  )

  if (error) {
    return Response.json(
      { error: 'Não foi possível listar os cadastros pendentes.' },
      { status: 500 }
    )
  }

  return Response.json({ signups: data ?? [] })
}
