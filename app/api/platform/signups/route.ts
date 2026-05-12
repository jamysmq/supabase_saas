import { requirePlatformAdmin } from '../../../../src/lib/platform-admin'

export async function GET(request: Request) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { data, error } = await result.supabase.rpc(
    'admin_list_pending_signups'
  )

  if (error) {
    return Response.json(
      { error: 'Could not list pending signups.' },
      { status: 500 }
    )
  }

  return Response.json({ signups: data ?? [] })
}
