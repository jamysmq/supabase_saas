import { requirePlatformAdmin } from '../../../../../../src/lib/platform-admin'

function generateTemporaryPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  const token = Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 16)

  return `Temp${token}!9`
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tenantUserId: string }> }
) {
  const result = await requirePlatformAdmin(request)

  if (result.error) return result.error

  const { tenantUserId } = await context.params

  const { data: tenantUser, error: tenantUserError } = await result.supabase
    .from('tenant_users')
    .select('id, email, auth_user_id')
    .eq('id', tenantUserId)
    .single()

  if (tenantUserError || !tenantUser) {
    return Response.json({ error: 'Usuário do negócio não encontrado.' }, { status: 404 })
  }

  const temporaryPassword = generateTemporaryPassword()
  let authUserId = tenantUser.auth_user_id

  if (!authUserId) {
    const { data: createdUser, error: createUserError } =
      await result.supabase.auth.admin.createUser({
        email: tenantUser.email,
        password: temporaryPassword,
        email_confirm: true,
      })

    if (createUserError || !createdUser.user) {
      return Response.json(
        { error: 'Não foi possível criar o usuário de autenticação.' },
        { status: 500 }
      )
    }

    authUserId = createdUser.user.id
  } else {
    const { error: updateUserError } =
      await result.supabase.auth.admin.updateUserById(authUserId, {
        password: temporaryPassword,
        email_confirm: true,
      })

    if (updateUserError) {
      return Response.json(
        { error: 'Não foi possível redefinir a senha de autenticação.' },
        { status: 500 }
      )
    }
  }

  const { error: updateTenantUserError } = await result.supabase
    .from('tenant_users')
    .update({
      auth_user_id: authUserId,
      must_change_password: true,
      temp_password_created_at: new Date().toISOString(),
    })
    .eq('id', tenantUser.id)

  if (updateTenantUserError) {
    return Response.json(
      { error: 'Não foi possível atualizar o usuário do negócio.' },
      { status: 500 }
    )
  }

  return Response.json({
    email: tenantUser.email,
    temporary_password: temporaryPassword,
  })
}
