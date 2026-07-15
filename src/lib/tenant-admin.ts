import { createClient } from '@supabase/supabase-js'
import {
  tenantCanUseAppointments as planCanUseAppointments,
  tenantCanUseBilling as planCanUseBilling,
  tenantCanUseCatalog as planCanUseCatalog,
  tenantCanUseRestaurant as planCanUseRestaurant,
  tenantCanUseSalonInventory as planCanUseSalonInventory,
} from './plan-features'

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

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, legal_name, public_name, plan, status, business_type')
    .eq('id', tenantUser.tenant_id)
    .single()

  if (tenantError || !tenant) {
    return {
      error: Response.json({ error: 'Tenant not found.' }, { status: 403 }),
    }
  }

  return {
    supabase,
    user,
    tenantUser,
    tenant,
  }
}

export function tenantCanUseAppointments(tenant: { plan?: string | null }) {
  return planCanUseAppointments(tenant.plan)
}

export function tenantCanUseBilling(tenant: { plan?: string | null }) {
  return planCanUseBilling(tenant.plan)
}

export function tenantCanUseCatalog(tenant: { plan?: string | null }) {
  return planCanUseCatalog(tenant.plan)
}

// Alias retrocompatível para rotas/templates que ainda usam o nome antigo.
export function tenantCanUseRestaurant(tenant: { plan?: string | null }) {
  return planCanUseRestaurant(tenant.plan)
}

export function tenantCanUseSalonInventory(tenant: {
  plan?: string | null
  business_type?: string | null
}) {
  return planCanUseSalonInventory(tenant.plan, tenant.business_type)
}
