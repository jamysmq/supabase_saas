import { createClient } from '@supabase/supabase-js'
import { requireTenantUser } from '../../../src/lib/tenant-admin'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function createPasswordAuthClient() {
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase public credentials are not configured.')
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export async function PATCH(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const body = await request.json().catch(() => null)
  const currentPassword = String(body?.current_password ?? '')
  const newPassword = String(body?.new_password ?? '')
  const confirmPassword = String(body?.confirm_password ?? '')
  const email = result.user.email ?? result.tenantUser.email

  if (!email) {
    return errorResponse('Nao foi possivel validar o email do usuario.', 403)
  }

  if (!currentPassword) {
    return errorResponse('Informe a senha atual.')
  }

  if (newPassword.length < 8) {
    return errorResponse('A nova senha precisa ter pelo menos 8 caracteres.')
  }

  if (newPassword !== confirmPassword) {
    return errorResponse('As senhas nao conferem.')
  }

  const authClient = createPasswordAuthClient()
  const { data: signInData, error: signInError } =
    await authClient.auth.signInWithPassword({
      email,
      password: currentPassword,
    })

  if (signInError || signInData.user?.id !== result.user.id) {
    return errorResponse('Senha atual invalida.', 401)
  }

  await authClient.auth.signOut()

  const { error: updateError } =
    await result.supabase.auth.admin.updateUserById(result.user.id, {
      password: newPassword,
    })

  if (updateError) {
    return errorResponse('Nao foi possivel alterar a senha.', 500, updateError.message)
  }

  const { error: clearPasswordFlagError } = await result.supabase.rpc(
    'admin_clear_must_change_password',
    {
      p_auth_user_id: result.user.id,
    }
  )

  if (clearPasswordFlagError) {
    return errorResponse(
      'Senha alterada, mas nao foi possivel liberar o acesso. Avise o suporte.',
      500,
      clearPasswordFlagError.message
    )
  }

  return Response.json({ ok: true })
}
