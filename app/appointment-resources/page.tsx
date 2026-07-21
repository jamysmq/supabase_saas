'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import {
  formatCentsAsMoneyInput,
  formatCurrencyFromCents,
  formatMoneyInput,
} from '../../src/lib/money'

type BookableResource = {
  id: string
  name: string
  kind: 'court' | 'environment'
  description: string | null
  duration_minutes: number
  price_cents: number | null
}

type FormState = {
  name: string
  kind: 'court' | 'environment'
  description: string
  duration_minutes: string
  price: string
}

const emptyForm: FormState = {
  name: '',
  kind: 'court',
  description: '',
  duration_minutes: '60',
  price: '',
}

export default function AppointmentResourcesPage() {
  const router = useRouter()
  const [resources, setResources] = useState<BookableResource[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function goBack() {
    const origin = new URLSearchParams(window.location.search).get('from')
    router.push(origin === 'dashboard' ? '/dashboard' : '/appointments')
  }

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/appointment-resources', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || 'Não foi possível carregar os ambientes.')
      setLoading(false)
      return
    }

    setResources(data.resources ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  function edit(resource: BookableResource) {
    setEditingId(resource.id)
    setForm({
      name: resource.name,
      kind: resource.kind,
      description: resource.description ?? '',
      duration_minutes: String(resource.duration_minutes),
      price: resource.price_cents === null ? '' : formatCentsAsMoneyInput(resource.price_cents),
    })
    setError('')
    setSuccess('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId('')
    setForm(emptyForm)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(
      editingId ? `/api/appointment-resources/${editingId}` : '/api/appointment-resources',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      }
    )
    const data = await response.json().catch(() => null)
    setSaving(false)

    if (!response.ok) {
      setError(data?.message || 'Não foi possível salvar o ambiente.')
      return
    }

    setSuccess(editingId ? 'Ambiente atualizado.' : 'Ambiente criado.')
    cancelEdit()
    await load()
  }

  async function remove(resource: BookableResource) {
    if (!confirm(`Excluir ${resource.name}?`)) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch(`/api/appointment-resources/${resource.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setError(data?.message || 'Não foi possível excluir o ambiente.')
      return
    }

    setSuccess('Ambiente excluído.')
    await load()
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-sky-50">Carregando...</main>
  }

  return (
    <main className="min-h-screen bg-sky-50 px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            ← Voltar
          </button>
          <h1 className="mt-3 text-2xl font-bold">Ambientes</h1>
          <p className="mt-1 text-sm text-slate-600">
            Locais para aluguel, como quadras, salões de festa, piscinas e outros espaços.
          </p>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

        <form onSubmit={save} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold">{editingId ? 'Editar local' : 'Novo local'}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Nome
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal"
                placeholder="Ex.: Quadra 1"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Tipo
              <select
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value as FormState['kind'] })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal"
              >
                <option value="court">Quadra</option>
                <option value="environment">Ambiente</option>
              </select>
            </label>
          </div>
          <label className="block text-sm font-medium">
            Descrição
            <input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal"
              placeholder="Ex.: Quadra coberta com iluminação"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">
              Duração padrão (minutos)
              <input
                value={form.duration_minutes}
                onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal"
                type="number"
                min="15"
                max="480"
                step="15"
                required
              />
            </label>
            <label className="text-sm font-medium">
              Valor do aluguel
              <input
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                onBlur={() => setForm({ ...form, price: formatMoneyInput(form.price) })}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal"
                inputMode="decimal"
                placeholder="R$ 0,00"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar local'}
            </button>
            {editingId && (
              <button type="button" onClick={cancelEdit} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium">
                Cancelar
              </button>
            )}
          </div>
        </form>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-bold">Locais cadastrados</h2>
          {resources.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">Nenhum ambiente cadastrado.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {resources.map((resource) => (
                <article key={resource.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold">{resource.name}</p>
                    <p className="text-sm text-slate-600">
                      {resource.kind === 'court' ? 'Quadra' : 'Ambiente'} · {resource.duration_minutes} min · {resource.price_cents === null ? 'Valor não informado' : formatCurrencyFromCents(resource.price_cents)}
                    </p>
                    {resource.description && <p className="mt-1 text-sm text-slate-500">{resource.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => edit(resource)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium">Editar</button>
                    <button onClick={() => void remove(resource)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700">Excluir</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
