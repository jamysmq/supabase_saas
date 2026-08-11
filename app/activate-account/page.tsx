'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { markPublicSessionActive } from '../../src/lib/public-session'
import { supabase } from '../../src/lib/supabase'

export default function ActivateAccountPage() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setHasSession(Boolean(session))
      setCheckingSession(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function definePassword(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }

    if (password !== confirmPassword) {
      setError('As senhas não conferem.')
      return
    }

    setSaving(true)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setSaving(false)
      setHasSession(false)
      setError('Este convite expirou ou já foi utilizado. Solicite um novo link.')
      return
    }

    const response = await fetch('/api/tenant-password', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        onboarding: true,
        new_password: password,
        confirm_password: confirmPassword,
      }),
    })

    setSaving(false)

    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      setError(payload?.message ?? 'Não foi possível definir sua senha.')
      return
    }

    markPublicSessionActive('tenant')
    router.push('/dashboard')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#dff4ff_0%,#f7fbff_52%,#eef8ff_100%)] px-4 text-slate-950">
      <section className="w-full max-w-md rounded-xl border border-sky-100 bg-white p-6 shadow">
        <p className="text-sm font-bold uppercase tracking-[0.14em] text-sky-700">
          Assistente João
        </p>
        <h1 className="mt-3 text-2xl font-bold">Ative seu acesso</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          E-mail confirmado! Agora escolha sua senha para acessar o painel.
        </p>

        {checkingSession ? (
          <p className="mt-6 text-sm text-slate-500">Validando seu convite...</p>
        ) : hasSession ? (
          <form className="mt-6 space-y-4" onSubmit={definePassword}>
            <label className="block text-sm font-medium">
              Nova senha
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mínimo de 8 caracteres"
                required
                type="password"
                value={password}
              />
            </label>

            <label className="block text-sm font-medium">
              Confirme a nova senha
              <input
                autoComplete="new-password"
                className="mt-1 w-full rounded-lg border border-sky-100 px-3 py-2"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              className="w-full rounded-lg bg-sky-700 py-2 font-bold text-white hover:bg-sky-800 disabled:opacity-50"
              disabled={saving}
              type="submit"
            >
              {saving ? 'Ativando...' : 'Definir senha e acessar'}
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Este convite expirou ou já foi utilizado. Peça um novo link de acesso.
            </p>
            <Link
              className="block rounded-lg border border-sky-200 px-4 py-2 text-center text-sm font-bold text-sky-800"
              href="/login"
            >
              Ir para o login
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
