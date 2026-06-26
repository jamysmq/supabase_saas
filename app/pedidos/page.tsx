'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseCatalog } from '../../src/lib/plan-features'
import { getCatalogLabels } from '../../src/lib/business-labels'
import { formatCurrencyFromCents } from '../../src/lib/money'

type OrderItem = {
  id: string
  menu_group_name_snapshot: string | null
  item_name_snapshot: string
  unit_price_cents: number
  quantity: number
  total_cents: number
  notes: string | null
}

type CatalogOrder = {
  id: string
  customer_name: string | null
  customer_phone_e164: string | null
  delivery_address: string | null
  notes: string | null
  total_cents: number
  currency: string
  payment_method: string
  status: string
  source: string
  confirmed_at: string
  paid_at: string | null
  cancelled_at: string | null
  tenant_restaurant_order_items: OrderItem[]
}

type MenuItem = {
  id: string
  group_id: string | null
  name: string
  description: string | null
  price_cents: number
}

type CartItem = {
  item: MenuItem
  quantity: number
}

const emptyForm = {
  customer_name: '',
  customer_phone_e164: '',
  delivery_address: '',
  payment_method: 'cash_on_delivery',
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

function paymentLabel(value: string) {
  const labels: Record<string, string> = {
    cash_on_delivery: 'Dinheiro na entrega',
    pix_on_delivery: 'Pix na entrega',
    card_on_delivery: 'Cartão na entrega',
    online_pix: 'Pix online',
    online_card: 'Cartão online',
  }

  return labels[value] ?? value
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    confirmed: 'Confirmado',
    paid: 'Pago/entregue',
    cancelled: 'Cancelado',
  }

  return labels[value] ?? value
}

export default function OrdersPage() {
  const router = useRouter()

  const [businessType, setBusinessType] = useState<string | null>(null)
  const [orders, setOrders] = useState<CatalogOrder[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [itemQuery, setItemQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [paymentMethod, setPaymentMethod] = useState('cash_on_delivery')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actingId, setActingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const catalog = getCatalogLabels(businessType)

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token ?? ''
  }

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

    if (!tenantCanUseCatalog(result.tenant?.plan)) {
      router.push('/dashboard')
      return
    }

    setBusinessType(result.tenant?.business_type ?? null)

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    const headers = {
      Authorization: `Bearer ${token}`,
    }
    const [ordersResponse, menuItemsResponse] = await Promise.all([
      fetch('/api/catalog/orders?status=confirmed', { headers }),
      fetch('/api/catalog/menu-items', { headers }),
    ])

    if (!ordersResponse.ok || !menuItemsResponse.ok) {
      const data = await ordersResponse.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar os pedidos.')
      setLoading(false)
      return
    }

    const [ordersData, menuItemsData] = await Promise.all([
      ordersResponse.json(),
      menuItemsResponse.json(),
    ])
    setOrders(ordersData.orders ?? [])
    setMenuItems(menuItemsData.items ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const stats = useMemo(() => {
    return {
      pending: orders.filter((order) => order.status === 'confirmed').length,
      total: orders.reduce((sum, order) => sum + order.total_cents, 0),
    }
  }, [orders])

  const filteredMenuItems = useMemo(() => {
    const normalizedQuery = itemQuery.trim().toLowerCase()

    if (!normalizedQuery) return menuItems

    return menuItems.filter((item) => (
      item.name.toLowerCase().includes(normalizedQuery) ||
      (item.description ?? '').toLowerCase().includes(normalizedQuery)
    ))
  }, [itemQuery, menuItems])

  const cartTotalCents = useMemo(() => {
    return cartItems.reduce((sum, cartItem) => (
      sum + cartItem.item.price_cents * cartItem.quantity
    ), 0)
  }, [cartItems])

  function addCartItem(item: MenuItem) {
    setCartItems((currentItems) => {
      const existingItem = currentItems.find((cartItem) => cartItem.item.id === item.id)

      if (existingItem) {
        return currentItems.map((cartItem) => (
          cartItem.item.id === item.id
            ? { ...cartItem, quantity: cartItem.quantity + 1 }
            : cartItem
        ))
      }

      return [...currentItems, { item, quantity: 1 }]
    })
  }

  function updateCartItemQuantity(itemId: string, quantity: number) {
    if (quantity <= 0) {
      setCartItems((currentItems) => currentItems.filter((cartItem) => cartItem.item.id !== itemId))
      return
    }

    setCartItems((currentItems) => currentItems.map((cartItem) => (
      cartItem.item.id === itemId
        ? { ...cartItem, quantity: Math.min(quantity, 99) }
        : cartItem
    )))
  }

  async function createManualOrder(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    if (cartItems.length === 0) {
      setError(`Adicione pelo menos um ${catalog.itemSingular} ao carrinho.`)
      setSaving(false)
      return
    }

    const response = await fetch('/api/catalog/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...form,
        items: cartItems.map((cartItem) => ({
          menu_item_id: cartItem.item.id,
          quantity: cartItem.quantity,
        })),
      }),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível criar o pedido.')
      return
    }

    setSuccess('Pedido inserido na fila.')
    setForm(emptyForm)
    setCartItems([])
    setItemQuery('')
    await load()
  }

  async function updateOrder(order: CatalogOrder, action: 'pay' | 'cancel') {
    const confirmed = action === 'pay'
      ? confirm('Confirmar pagamento/entrega deste pedido?')
      : confirm('Cancelar este pedido?')
    if (!confirmed) return

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setActingId(order.id)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/catalog/orders/${order.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
        payment_method: paymentMethod,
      }),
    })

    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível atualizar o pedido.')
      return
    }

    setSuccess(action === 'pay' ? 'Pedido baixado no financeiro.' : 'Pedido cancelado.')
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
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950 print:bg-white print:px-0 print:py-0">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
          <div className="mb-3 flex flex-wrap items-center gap-3 print:hidden">
            <button onClick={() => router.push('/dashboard')} className="text-sm text-gray-500">
              Voltar
            </button>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Pedidos pendentes</h1>
              <p className="mt-1 text-sm text-gray-500">
                Pedidos confirmados no WhatsApp ficam aqui até a baixa financeira.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:w-[360px] print:grid-cols-2">
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
                <span className="font-bold">{stats.pending}</span> pendentes
              </div>
              <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold">
                {formatCurrencyFromCents(stats.total)}
              </div>
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{success}</div>}

        <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4 print:hidden">
            <form onSubmit={createManualOrder} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <h2 className="font-bold">Novo pedido</h2>
              <input
                value={form.customer_name}
                onChange={(event) => setForm({ ...form, customer_name: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Cliente"
                required
              />
              <input
                value={form.customer_phone_e164}
                onChange={(event) => setForm({ ...form, customer_phone_e164: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="WhatsApp"
              />
              <input
                value={form.delivery_address}
                onChange={(event) => setForm({ ...form, delivery_address: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Endereço"
              />
              <input
                value={itemQuery}
                onChange={(event) => setItemQuery(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder={`Buscar ${catalog.itemSingular}`}
              />
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-gray-100 p-2">
                {filteredMenuItems.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-500">Nenhum {catalog.itemSingular} encontrado.</p>
                ) : (
                  filteredMenuItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addCartItem(item)}
                      className="w-full rounded-xl border border-gray-100 p-3 text-left hover:bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-semibold">{item.name}</div>
                          {item.description && (
                            <div className="mt-1 break-words text-xs text-gray-500">{item.description}</div>
                          )}
                        </div>
                        <div className="shrink-0 text-sm font-bold">
                          {formatCurrencyFromCents(item.price_cents)}
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <section className="rounded-xl bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">Carrinho</h3>
                  <span className="text-sm font-bold">{formatCurrencyFromCents(cartTotalCents)}</span>
                </div>

                {cartItems.length === 0 ? (
                  <p className="py-3 text-sm text-gray-500">Nenhum {catalog.itemSingular} adicionado.</p>
                ) : (
                  <div className="space-y-2">
                    {cartItems.map((cartItem) => (
                      <div key={cartItem.item.id} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-2">
                        <div className="min-w-0">
                          <div className="break-words text-sm font-medium">{cartItem.item.name}</div>
                          <div className="text-xs text-gray-500">
                            {formatCurrencyFromCents(cartItem.item.price_cents * cartItem.quantity)}
                          </div>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={cartItem.quantity}
                          onChange={(event) => updateCartItemQuantity(cartItem.item.id, Number(event.target.value))}
                          className="w-full rounded-lg border border-gray-200 px-2 py-1 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <select
                value={form.payment_method}
                onChange={(event) => setForm({ ...form, payment_method: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="cash_on_delivery">Dinheiro na entrega</option>
                <option value="pix_on_delivery">Pix na entrega</option>
                <option value="card_on_delivery">Cartão na entrega</option>
              </select>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Observações"
              />
              <button
                type="submit"
                disabled={saving || cartItems.length === 0}
                className="w-full rounded-lg bg-gray-950 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Inserir pedido'}
              </button>
            </form>

            <section className="rounded-2xl bg-white p-5 shadow space-y-3">
              <h2 className="font-bold">Baixa</h2>
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="cash_on_delivery">Dinheiro na entrega</option>
                <option value="pix_on_delivery">Pix na entrega</option>
                <option value="card_on_delivery">Cartão na entrega</option>
              </select>
            </section>
          </div>

          <section className="rounded-2xl bg-white p-5 shadow print:rounded-none print:p-0 print:shadow-none">
            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">Nenhum pedido pendente.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {orders.map((order) => (
                  <article key={order.id} className="py-4 print:break-inside-avoid">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-bold">
                          {order.customer_name || 'Cliente sem nome'}
                        </div>
                        <div className="mt-1 text-sm text-gray-500">
                          {order.customer_phone_e164 || 'Sem WhatsApp'} - {formatDateTime(order.confirmed_at)}
                        </div>
                        {order.delivery_address && (
                          <div className="mt-1 break-words text-sm text-gray-500">{order.delivery_address}</div>
                        )}
                      </div>
                      <div className="text-left sm:text-right">
                        <div className="text-sm font-bold">{formatCurrencyFromCents(order.total_cents)}</div>
                        <div className="mt-1 text-xs text-gray-500">{statusLabel(order.status)}</div>
                        <div className="mt-1 text-xs text-gray-500">{paymentLabel(order.payment_method)}</div>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl bg-gray-50 p-3">
                      {order.tenant_restaurant_order_items.map((item) => (
                        <div key={item.id} className="flex justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words">
                            {item.quantity}x {item.item_name_snapshot}
                          </span>
                          <span className="shrink-0 font-medium">{formatCurrencyFromCents(item.total_cents)}</span>
                        </div>
                      ))}
                    </div>

                    {order.status === 'confirmed' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void updateOrder(order, 'pay')}
                          disabled={actingId === order.id}
                          className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 print:hidden"
                        >
                          Confirmar pagamento
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateOrder(order, 'cancel')}
                          disabled={actingId === order.id}
                          className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-50 print:hidden"
                        >
                          Cancelar pedido
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
