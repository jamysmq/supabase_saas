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
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#dff4ff_0%,#f7fbff_52%,#eef8ff_100%)] px-4 text-slate-950">
      <div className="relative w-full max-w-sm rounded-lg border border-sky-100 bg-white p-6 shadow">
        <a
          href="https://www.meuassistentevirtual.com.br/"
          className="absolute right-4 top-4 inline-flex h-9 w-11 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100"
          aria-label="Página inicial"
          title="Página inicial"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="m3 11 9-8 9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M9 20v-6h6v6" />
          </svg>
        </a>

        <h1 className="mb-2 pr-14 text-2xl font-bold text-gray-950">Entrar</h1>
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
            className="w-full rounded-lg bg-sky-700 py-2 font-bold text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>

          <a
            href="https://www.meuassistentevirtual.com.br/cadastro"
            className="block w-full rounded-lg border border-sky-200 px-4 py-2 text-center text-sm font-bold text-sky-800 hover:bg-sky-50"
          >
            Se cadastre!
          </a>
        </form>

      </div>
    </main>
  )
}
