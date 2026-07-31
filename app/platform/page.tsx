'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { clearPublicSessionMarker, markPublicSessionActive } from '../../src/lib/public-session'
import { supabase } from '../../src/lib/supabase'
import { NotificationBell } from './platform-dashboard-button'

type PendingCategory = {
  id: string
  title: string
  description: string
  count: number
  href: string
  action: string
}

type OperationalIssue = {
  id: string
  severity: 'critical' | 'warning'
  title: string
  description: string
  workflowName?: string
  executionId?: string | null
  detectedAt: string
}

type Summary = {
  total: number
  administrativeCount: number
  operationalCount: number
  hasCritical: boolean
  categories: PendingCategory[]
  operations: {
    configured: boolean
    checkedAt: string
    healthyWorkflows: number
    totalWorkflows: number
    issues: OperationalIssue[]
  }
  warnings: string[]
}

export default function PlatformPage() {
  const router = useRouter()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/platform/notifications/summary', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    })

    if (response.status === 401) {
      router.push('/login')
      return
    }

    if (response.status === 403) {
      setError('Seu usuário não tem permissão de administrador da plataforma.')
      setLoading(false)
      return
    }

    if (!response.ok) {
      setError('Não foi possível carregar as pendências da plataforma.')
      setLoading(false)
      return
    }

    markPublicSessionActive('platform')
    setSummary(await response.json())
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0)
    const intervalId = window.setInterval(() => void load(), 60_000)
    return () => {
      window.clearTimeout(timeoutId)
      window.clearInterval(intervalId)
    }
  }, [load])

  async function logout() {
    await supabase.auth.signOut()
    clearPublicSessionMarker()
    router.push('/login')
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-gray-100">Carregando...</main>
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className={`rounded-xl p-3 ${summary?.hasCritical ? 'bg-red-100 text-red-700' : summary?.total ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                <NotificationBell className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-2xl font-bold">Dashboard da plataforma</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Tudo que precisa de aprovação, revisão ou resposta em um só lugar.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link href="/platform/tenants" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Negócios
              </Link>
              <Link href="/platform/plans" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Planos
              </Link>
              <button onClick={() => void load()} className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800 hover:bg-sky-100">
                Atualizar
              </button>
              <button onClick={logout} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50">
                Sair
              </button>
            </div>
          </div>
        </section>

        {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {summary && (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-gray-950 p-5 text-white shadow">
                <p className="text-sm text-gray-300">Total para revisar</p>
                <p className="mt-2 text-3xl font-bold">{summary.total}</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow">
                <p className="text-sm text-gray-500">Pendências administrativas</p>
                <p className="mt-2 text-3xl font-bold">{summary.administrativeCount}</p>
              </div>
              <div className={`rounded-2xl p-5 shadow ${summary.operationalCount ? 'bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-900'}`}>
                <p className="text-sm">Alertas operacionais</p>
                <p className="mt-2 text-3xl font-bold">{summary.operationalCount}</p>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <div className="mb-4">
                <h2 className="text-lg font-bold">Ações pendentes</h2>
                <p className="text-sm text-gray-500">O indicador desaparece quando cada fila fica resolvida.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {summary.categories.map((category) => (
                  <Link
                    key={category.id}
                    href={category.href}
                    className={`rounded-xl border p-4 transition hover:-translate-y-0.5 hover:shadow ${category.count ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">{category.title}</h3>
                        <p className="mt-1 text-sm text-gray-600">{category.description}</p>
                      </div>
                      <span className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-1 text-sm font-bold ${category.count ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        {category.count}
                      </span>
                    </div>
                    <p className="mt-4 text-sm font-semibold text-sky-800">{category.action} →</p>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold">Saúde das automações</h2>
                  <p className="text-sm text-gray-500">
                    {summary.operations.healthyWorkflows} de {summary.operations.totalWorkflows} workflows críticos saudáveis.
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  Conferido em {new Date(summary.operations.checkedAt).toLocaleString('pt-BR')}
                </p>
              </div>

              {summary.operations.issues.length === 0 ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
                  Nenhum problema operacional detectado.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {summary.operations.issues.map((issue) => (
                    <article key={issue.id} className={`rounded-xl border p-4 ${issue.severity === 'critical' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${issue.severity === 'critical' ? 'bg-red-700 text-white' : 'bg-amber-600 text-white'}`}>
                          {issue.severity === 'critical' ? 'Crítico' : 'Atenção'}
                        </span>
                        <h3 className="font-bold">{issue.title}</h3>
                      </div>
                      <p className="mt-2 text-sm text-gray-700">{issue.description}</p>
                      {issue.executionId && <p className="mt-1 text-xs text-gray-500">Execução n8n: {issue.executionId}</p>}
                    </article>
                  ))}
                </div>
              )}

              {summary.warnings.length > 0 && (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  Algumas filas não puderam ser consultadas: {summary.warnings.join(', ')}.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
