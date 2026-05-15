import { supabase } from '../lib/supabase'

export async function getCurrentTenantUser() {
  const { data: authData, error: authError } =
    await supabase.auth.getUser()

  if (authError || !authData.user) {
    return null
  }

  const authUserId = authData.user.id

  const { data: tenantUser, error: tenantError } =
    await supabase
      .from('tenant_users')
      .select(`
        id,
        tenant_id,
        role,
        email,
        must_change_password
      `)
      .eq('auth_user_id', authUserId)
      .single()

  if (tenantError || !tenantUser) {
    return null
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('business_type, plan')
    .eq('id', tenantUser.tenant_id)
    .maybeSingle()

  return {
    authUser: authData.user,
    tenantUser,
    tenant,
  }
}
