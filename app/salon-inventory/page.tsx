'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrencyFromCents, formatMoneyInput } from '../../src/lib/money'
import { tenantCanUseSalonInventory } from '../../src/lib/plan-features'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'

type Product = {
  id: string
  name: string
  sku: string | null
  current_quantity: number
  unit_cost_cents: number
  total_cost_cents: number
  updated_at: string
}

type Movement = {
  id: string
  product_id: string
  movement_type: string
  quantity_delta: number
  unit_cost_cents: number
  total_cost_cents: number
  supplier: string | null
  notes: string | null
  created_at: string
  product: {
    name: string | null
    sku: string | null
  } | null
}

type InventoryForm = {
  name: string
  sku: string
  quantity: string
  unit_cost: string
  supplier: string
  notes: string
}

const emptyForm: InventoryForm = {
  name: '',
  sku: '',
  quantity: '1',
  unit_cost: '',
  supplier: '',
  notes: '',
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: 3,
  }).format(value)
}

export default function SalonInventoryPage() {
  const router = useRouter()

  const [products, setProducts] = useState<Product[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [form, setForm] = useState<InventoryForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const stats = useMemo(() => ({
    products: products.length,
    quantity: products.reduce((sum, product) => sum + Number(product.current_quantity || 0), 0),
    value: products.reduce((sum, product) => sum + Number(product.total_cost_cents || 0), 0),
  }), [products])

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')

    const result = await getCurrentTenantUser()

    if (!result) {
      router.push('/login')
      return
    }

    if (result.tenantUser.must_change_password) {
      router.push('/change-password')
      return
    }

    if (!tenantCanUseSalonInventory(result.tenant?.plan, result.tenant?.business_type)) {
      router.push('/dashboard')
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/salon-inventory', {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Nao foi possivel carregar o estoque.')
      setLoading(false)
      return
    }

    const data = await response.json()
    setProducts(data.products ?? [])
    setMovements(data.movements ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const response = await fetch('/api/salon-inventory', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(form),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Nao foi possivel salvar o produto.')
      return
    }

    setSuccess('Entrada de estoque registrada.')
    setForm(emptyForm)
    await load()
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow">
          <button onClick={() => router.push('/dashboard')} className="mb-3 text-sm text-gray-500">
            Voltar
          </button>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Estoque</h1>
              <p className="mt-1 text-sm text-gray-500">
                Registre produtos comprados para o salao e acompanhe o custo no financeiro.
              </p>
            </div>

            <button
              onClick={() => void load()}
              className="h-10 rounded-lg border border-gray-200 px-4 text-sm font-medium"
            >
              Atualizar
            </button>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">{success}</div>}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-sm text-gray-500">Produtos</p>
            <p className="mt-1 text-2xl font-bold">{stats.products}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-sm text-gray-500">Quantidade total</p>
            <p className="mt-1 text-2xl font-bold">{formatQuantity(stats.quantity)}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-sm text-gray-500">Custo em estoque</p>
            <p className="mt-1 text-2xl font-bold">{formatCurrencyFromCents(stats.value)}</p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <form onSubmit={save} className="space-y-4 rounded-2xl bg-white p-5 shadow">
            <div>
              <h2 className="font-bold">Adicionar produto</h2>
              <p className="mt-1 text-sm text-gray-500">
                O valor total entra como despesa no financeiro de atendimentos.
              </p>
            </div>

            <label className="block text-sm font-medium">
              Produto
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                maxLength={120}
                required
              />
            </label>

            <label className="block text-sm font-medium">
              Codigo/SKU
              <input
                value={form.sku}
                onChange={(event) => setForm({ ...form, sku: event.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                maxLength={80}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className="block text-sm font-medium">
                Quantidade
                <input
                  value={form.quantity}
                  onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                  inputMode="decimal"
                  required
                />
              </label>

              <label className="block text-sm font-medium">
                Valor unitario
                <input
                  value={form.unit_cost}
                  onChange={(event) => setForm({ ...form, unit_cost: event.target.value })}
                  onBlur={() => setForm((current) => ({
                    ...current,
                    unit_cost: current.unit_cost ? formatMoneyInput(current.unit_cost) : '',
                  }))}
                  className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  required
                />
              </label>
            </div>

            <label className="block text-sm font-medium">
              Fornecedor
              <input
                value={form.supplier}
                onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 font-normal"
                maxLength={120}
              />
            </label>

            <label className="block text-sm font-medium">
              Observacoes
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="mt-1 min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                maxLength={500}
              />
            </label>

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Registrar entrada'}
            </button>
          </form>

          <div className="space-y-4">
            <section className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold">Produtos em estoque</h2>
              {products.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">Nenhum produto cadastrado.</p>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {products.map((product) => (
                    <article key={product.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_120px_140px]">
                      <div>
                        <div className="font-semibold">{product.name}</div>
                        <div className="text-xs text-gray-500">{product.sku || 'Sem SKU'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Qtd.</div>
                        <div className="font-medium">{formatQuantity(Number(product.current_quantity))}</div>
                      </div>
                      <div className="sm:text-right">
                        <div className="text-xs text-gray-500">Custo total</div>
                        <div className="font-bold">{formatCurrencyFromCents(product.total_cost_cents)}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <h2 className="font-bold">Historico de entradas</h2>
              {movements.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">Nenhuma entrada registrada.</p>
              ) : (
                <div className="mt-3 divide-y divide-gray-100">
                  {movements.map((movement) => (
                    <article key={movement.id} className="grid gap-3 py-3 sm:grid-cols-[160px_1fr_140px]">
                      <div className="text-sm font-medium">{formatDateTime(movement.created_at)}</div>
                      <div>
                        <div className="font-semibold">{movement.product?.name || 'Produto'}</div>
                        <div className="text-xs text-gray-500">
                          {formatQuantity(Number(movement.quantity_delta))} un. x {formatCurrencyFromCents(movement.unit_cost_cents)}
                        </div>
                        {(movement.supplier || movement.notes) && (
                          <div className="mt-1 text-xs text-gray-500">
                            {[movement.supplier, movement.notes].filter(Boolean).join(' - ')}
                          </div>
                        )}
                      </div>
                      <div className="font-bold text-red-700 sm:text-right">
                        -{formatCurrencyFromCents(movement.total_cost_cents)}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
