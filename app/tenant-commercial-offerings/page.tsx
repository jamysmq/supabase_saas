'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import {
  formatCentsAsMoneyInput,
  formatCurrencyFromCents,
  formatMoneyInput,
} from '../../src/lib/money'

type OfferType = 'membership' | 'rental'
type PriceUnit = 'monthly' | 'hourly' | 'daily' | 'per_class' | 'per_session' | 'package' | 'one_time' | 'custom'

type Offering = {
  id: string
  offer_type: OfferType
  name: string
  description: string | null
  price_cents: number
  price_unit: PriceUnit
  custom_unit_label: string | null
  is_active: boolean
  sort_order: number
}

type OfferingForm = {
  offer_type: OfferType
  name: string
  description: string
  price: string
  price_unit: PriceUnit
  custom_unit_label: string
  sort_order: string
  is_active: boolean
}

const unitLabels: Record<PriceUnit, string> = {
  monthly: 'por mês',
  hourly: 'por hora',
  daily: 'por dia',
  per_class: 'por aula',
  per_session: 'por sessão',
  package: 'por pacote',
  one_time: 'pagamento único',
  custom: 'unidade personalizada',
}

const emptyForm: OfferingForm = {
  offer_type: 'membership',
  name: '',
  description: '',
  price: '',
  price_unit: 'monthly',
  custom_unit_label: '',
  sort_order: '0',
  is_active: true,
}

export default function TenantCommercialOfferingsPage() {
  const router = useRouter()
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<OfferingForm>(emptyForm)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const token = await getToken()
    if (!token) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/tenant-commercial-offerings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (response.status === 401) {
      router.push('/login')
      return
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar os planos e preços.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setOfferings(data.offerings ?? [])
    setLoading(false)
  }, [getToken, router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [load])

  function startCreate(type: OfferType = 'membership') {
    setEditingId('')
    setForm({
      ...emptyForm,
      offer_type: type,
      price_unit: type === 'rental' ? 'hourly' : 'monthly',
    })
    setShowForm(true)
    setError('')
    setSuccess('')
  }

  function startEdit(offering: Offering) {
    setEditingId(offering.id)
    setForm({
      offer_type: offering.offer_type,
      name: offering.name,
      description: offering.description ?? '',
      price: formatCentsAsMoneyInput(offering.price_cents),
      price_unit: offering.price_unit,
      custom_unit_label: offering.custom_unit_label ?? '',
      sort_order: String(offering.sort_order),
      is_active: offering.is_active,
    })
    setShowForm(true)
    setError('')
    setSuccess('')
  }

  function closeForm() {
    setShowForm(false)
    setEditingId('')
    setForm(emptyForm)
  }

  async function saveOffering(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    const token = await getToken()
    if (!token) {
      router.push('/login')
      return
    }

    const response = await fetch(
      editingId ? `/api/tenant-commercial-offerings/${editingId}` : '/api/tenant-commercial-offerings',
      {
        method: editingId ? 'PUT' : 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }
    )
    setSaving(false)
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível salvar a oferta.')
      return
    }

    setSuccess(editingId ? 'Oferta atualizada.' : 'Oferta criada.')
    closeForm()
    await load()
  }

  async function toggleOffering(offering: Offering) {
    setSaving(true)
    setError('')
    const token = await getToken()
    if (!token) return router.push('/login')
    const response = await fetch(`/api/tenant-commercial-offerings/${offering.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...offering,
        price: formatCentsAsMoneyInput(offering.price_cents),
        is_active: !offering.is_active,
      }),
    })
    setSaving(false)
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível alterar o status da oferta.')
      return
    }
    setSuccess(offering.is_active ? 'Oferta ocultada do WhatsApp.' : 'Oferta publicada no WhatsApp.')
    await load()
  }

  async function deleteOffering(offering: Offering) {
    if (!window.confirm(`Excluir “${offering.name}”?`)) return
    setSaving(true)
    setError('')
    const token = await getToken()
    if (!token) return router.push('/login')
    const response = await fetch(`/api/tenant-commercial-offerings/${offering.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setSaving(false)
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível excluir a oferta.')
      return
    }
    setSuccess('Oferta excluída.')
    await load()
  }

  function priceLabel(offering: Offering) {
    const unit = offering.price_unit === 'custom'
      ? offering.custom_unit_label
      : unitLabels[offering.price_unit]
    return `${formatCurrencyFromCents(offering.price_cents)} ${unit ?? ''}`.trim()
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-sky-50 text-slate-950">Carregando...</main>
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#dff4ff_0%,#f4fbff_42%,#eef8ff_100%)] px-4 py-6 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-xl border border-sky-100 bg-white p-5 shadow">
          <Link href="/dashboard" className="inline-flex h-10 items-center rounded-lg border border-sky-200 px-4 text-sm font-semibold text-sky-800 hover:bg-sky-50">
            Voltar ao dashboard
          </Link>
          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Divulgação no WhatsApp</p>
              <h1 className="mt-1 text-2xl font-bold">Planos e preços</h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Cadastre planos, modalidades e preços de aluguel. O botão aparecerá no WhatsApp somente quando houver pelo menos uma oferta ativa.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => startCreate('membership')} className="h-10 rounded-lg bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800">Adicionar plano</button>
              <button onClick={() => startCreate('rental')} className="h-10 rounded-lg border border-sky-300 bg-sky-50 px-4 text-sm font-semibold text-sky-900 hover:bg-sky-100">Adicionar aluguel</button>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

        {showForm && (
          <form onSubmit={saveOffering} className="space-y-4 rounded-xl border border-sky-100 bg-white p-5 shadow">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold">{editingId ? 'Editar oferta' : 'Nova oferta'}</h2>
                <p className="mt-1 text-sm text-slate-500">Esta informação será exibida publicamente no WhatsApp.</p>
              </div>
              <button type="button" onClick={closeForm} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm">Fechar</button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-semibold">Tipo
                <select value={form.offer_type} onChange={(event) => setForm({ ...form, offer_type: event.target.value as OfferType })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal">
                  <option value="membership">Plano ou modalidade</option>
                  <option value="rental">Aluguel</option>
                </select>
              </label>
              <label className="text-sm font-semibold">Nome
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" placeholder="Ex.: Beach tennis 3x por semana" />
              </label>
            </div>

            <label className="block text-sm font-semibold">Descrição
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" placeholder="Explique o que está incluído, horários ou condições importantes." />
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="text-sm font-semibold">Preço
                <input value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} onBlur={() => setForm({ ...form, price: formatMoneyInput(form.price) })} inputMode="decimal" required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" placeholder="R$ 0,00" />
              </label>
              <label className="text-sm font-semibold">Cobrança
                <select value={form.price_unit} onChange={(event) => setForm({ ...form, price_unit: event.target.value as PriceUnit })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal">
                  {Object.entries(unitLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Ordem
                <input value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: event.target.value })} type="number" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" />
              </label>
            </div>

            {form.price_unit === 'custom' && (
              <label className="block text-sm font-semibold">Unidade personalizada
                <input value={form.custom_unit_label} onChange={(event) => setForm({ ...form, custom_unit_label: event.target.value })} maxLength={40} required className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" placeholder="Ex.: por dupla / 90 minutos" />
              </label>
            )}

            <label className="flex items-center gap-2 text-sm font-semibold">
              <input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" />
              Exibir esta oferta no WhatsApp
            </label>
            <button disabled={saving} className="w-full rounded-lg bg-slate-950 py-2.5 font-semibold text-white disabled:opacity-50">{saving ? 'Salvando...' : 'Salvar oferta'}</button>
          </form>
        )}

        <section className="grid gap-4 md:grid-cols-2">
          {(['membership', 'rental'] as OfferType[]).map((type) => {
            const rows = offerings.filter((offering) => offering.offer_type === type)
            return (
              <div key={type} className="rounded-xl border border-sky-100 bg-white p-5 shadow">
                <h2 className="font-bold">{type === 'membership' ? 'Planos e modalidades' : 'Preços de aluguel'}</h2>
                <div className="mt-4 space-y-3">
                  {rows.length === 0 ? (
                    <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Nenhuma oferta cadastrada.</p>
                  ) : rows.map((offering) => (
                    <article key={offering.id} className={`rounded-lg border p-4 ${offering.is_active ? 'border-sky-100 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{offering.name}</h3>
                          <p className="mt-1 font-bold text-sky-800">{priceLabel(offering)}</p>
                          {offering.description && <p className="mt-2 text-sm leading-5 text-slate-600">{offering.description}</p>}
                          <p className="mt-2 text-xs text-slate-500">{offering.is_active ? 'Visível no WhatsApp' : 'Oculta no WhatsApp'} · ordem {offering.sort_order}</p>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button onClick={() => startEdit(offering)} className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-semibold">Editar</button>
                        <button onClick={() => void toggleOffering(offering)} disabled={saving} className="rounded-lg border border-slate-200 px-2 py-2 text-sm font-semibold disabled:opacity-50">{offering.is_active ? 'Ocultar' : 'Publicar'}</button>
                        <button onClick={() => void deleteOffering(offering)} disabled={saving} className="rounded-lg border border-red-200 px-2 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Excluir</button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      </div>
    </main>
  )
}
