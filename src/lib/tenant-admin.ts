import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function createTenantAdminClient() {
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

export async function requireTenantUser(request: Request) {
  const authorization = request.headers.get('authorization')
  const token = authorization?.replace(/^Bearer\s+/i, '')

  if (!token) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const supabase = createTenantAdminClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)

  if (userError || !user) {
    return {
      error: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const { data: tenantUser, error: tenantUserError } = await supabase
    .from('tenant_users')
    .select('id, tenant_id, role, email')
    .eq('auth_user_id', user.id)
    .single()

  if (tenantUserError || !tenantUser) {
    return {
      error: Response.json({ error: 'Tenant user not found.' }, { status: 403 }),
    }
  }

  return {
    supabase,
    user,
    tenantUser,
  }
}
