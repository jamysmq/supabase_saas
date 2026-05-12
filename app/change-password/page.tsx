'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'

export default function ChangePasswordPage() {
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }

    setLoading(true)

    const { data: userData } = await supabase.auth.getUser()

    if (!userData.user) {
      setLoading(false)
      router.push('/login')
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      setLoading(false)
      setError('Não foi possível alterar a senha.')
      return
    }

    const { error: rpcError } = await supabase.rpc(
      'admin_clear_must_change_password',
      {
        p_auth_user_id: userData.user.id,
      }
    )

    setLoading(false)

    if (rpcError) {
      setError('Senha alterada, mas não foi possível liberar o acesso. Avise o suporte.')
      return
    }

    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold mb-2">Alterar senha</h1>

        <p className="text-sm text-gray-500 mb-6">
          Por segurança, defina uma nova senha antes de acessar o painel.
        </p>

        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              Nova senha
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Confirmar nova senha
            </label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a senha"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-black text-white py-2 font-medium disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </button>
        </form>
      </div>
    </main>
  )
}