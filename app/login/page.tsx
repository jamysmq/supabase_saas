'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (error) {
      setError('E-mail ou senha inválidos.')
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session) {
      const platformResponse = await fetch('/api/platform/me', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (platformResponse.ok) {
        router.push('/platform/tenants')
        return
      }
    }

    router.push('/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 px-4 text-gray-950">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold mb-2 text-gray-950">Entrar</h1>
        <p className="text-sm text-gray-600 mb-6">
          Acesse sua conta para gerenciar clientes e cobranças.
        </p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-800">E-mail</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-gray-950"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-800">Senha</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-gray-950"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gray-950 text-white py-2 font-medium disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  )
}
