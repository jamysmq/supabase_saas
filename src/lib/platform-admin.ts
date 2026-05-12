import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function createSupabaseAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase server credentials are not configured.')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function requirePlatformAdmin(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')

  if (!token) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const supabase = createSupabaseAdminClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { data: platformAdmin, error: platformAdminError } = await supabase
    .from('platform_admins')
    .select('auth_user_id, email, role, is_active')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .single()

  if (platformAdminError || !platformAdmin) {
    return {
      error: Response.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }

  return {
    supabase,
    user,
    platformAdmin,
  }
}
