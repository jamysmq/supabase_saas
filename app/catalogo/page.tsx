'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseCatalog } from '../../src/lib/plan-features'
import { getCatalogLabels } from '../../src/lib/business-labels'
import { formatCurrencyFromCents, formatMoneyInput } from '../../src/lib/money'

type MenuItem = {
  id: string
  group_id: string | null
  name: string
  description: string | null
  price_cents: number
  currency: string
}

type MenuGroup = {
  id: string
  name: string
  sort_order: number
}

type MenuForm = {
  group_id: string
  name: string
  description: string
  price: string
}

const emptyForm: MenuForm = {
  group_id: '',
  name: '',
  description: '',
  price: '',
}

function formatCurrency(valueCents: number) {
  return formatCurrencyFromCents(valueCents)
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function CatalogPage() {
  const router = useRouter()

  const [businessType, setBusinessType] = useState<string | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])
  const [groups, setGroups] = useState<MenuGroup[]>([])
  const [form, setForm] = useState<MenuForm>(emptyForm)
  const [groupForm, setGroupForm] = useState({ name: '', sort_order: '10' })
  const [editingItemId, setEditingItemId] = useState('')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actingId, setActingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const catalog = getCatalogLabels(businessType)
  const itemLabel = capitalize(catalog.itemSingular)

  const totalItems = useMemo(() => items.length, [items])
  const groupedItems = useMemo(() => {
    const groupMap = new Map(groups.map((group) => [group.id, group]))

    return [
      ...groups.map((group) => ({
        id: group.id,
        name: group.name,
        sort_order: group.sort_order,
        items: items.filter((item) => item.group_id === group.id),
      })),
      {
        id: '',
        name: 'Sem grupo',
        sort_order: 9999,
        items: items.filter((item) => !item.group_id || !groupMap.has(item.group_id)),
      },
    ].filter((group) => group.items.length > 0)
  }, [groups, items])

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
    const [itemsResponse, groupsResponse] = await Promise.all([
      fetch('/api/catalog/menu-items', { headers }),
      fetch('/api/catalog/menu-groups', { headers }),
    ])

    if (!itemsResponse.ok || !groupsResponse.ok) {
      const data = await itemsResponse.json().catch(() => null)
      setError(data?.message || 'Não foi possível carregar o catálogo.')
      setLoading(false)
      return
    }

    const [itemsData, groupsData] = await Promise.all([
      itemsResponse.json(),
      groupsResponse.json(),
    ])
    setItems(itemsData.items ?? [])
    setGroups(groupsData.groups ?? [])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function saveItem(event: React.FormEvent) {
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
      editingItemId
        ? `/api/catalog/menu-items/${editingItemId}`
        : '/api/catalog/menu-items',
      {
        method: editingItemId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      }
    )

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || `Não foi possível salvar o ${catalog.itemSingular}.`)
      return
    }

    setSuccess(editingItemId ? `${itemLabel} atualizado.` : `${itemLabel} criado.`)
    setEditingItemId('')
    setForm(emptyForm)
    await load()
  }

  async function saveGroup(event: React.FormEvent) {
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
      editingGroupId
        ? `/api/catalog/menu-groups/${editingGroupId}`
        : '/api/catalog/menu-groups',
      {
        method: editingGroupId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(groupForm),
      }
    )

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível salvar o grupo.')
      return
    }

    setSuccess(editingGroupId ? 'Grupo atualizado.' : 'Grupo criado.')
    setEditingGroupId('')
    setGroupForm({ name: '', sort_order: '10' })
    await load()
  }

  async function deleteItem(item: MenuItem) {
    const confirmed = confirm(`Excluir o ${catalog.itemSingular} ${item.name}?`)
    if (!confirmed) return

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setActingId(item.id)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/catalog/menu-items/${item.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || `Não foi possível excluir o ${catalog.itemSingular}.`)
      return
    }

    if (editingItemId === item.id) {
      setEditingItemId('')
      setForm(emptyForm)
    }

    setSuccess(`${itemLabel} excluído.`)
    await load()
  }

  async function deleteGroup(group: MenuGroup) {
    const confirmed = confirm(`Excluir o grupo ${group.name}? Os ${catalog.itemPlural} ficarão sem grupo.`)
    if (!confirmed) return

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setActingId(group.id)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/catalog/menu-groups/${group.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível excluir o grupo.')
      return
    }

    if (editingGroupId === group.id) {
      setEditingGroupId('')
      setGroupForm({ name: '', sort_order: '10' })
    }

    setSuccess('Grupo excluído.')
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
      <div className="mx-auto max-w-5xl space-y-4">
        <section className="rounded-2xl bg-white p-5 shadow">
          <button onClick={() => router.push('/dashboard')} className="mb-3 text-sm text-gray-500">
            Voltar
          </button>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold">{catalog.title}</h1>
              <p className="mt-1 text-sm text-gray-500">
                {catalog.pageHint}
              </p>
            </div>
            <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm">
              <span className="font-bold">{totalItems}</span> {catalog.itemPlural} ativos
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {success && <div className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{success}</div>}

        <section className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
          <form onSubmit={saveGroup} className="rounded-2xl bg-white p-5 shadow space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">{editingGroupId ? 'Editar grupo' : 'Novo grupo'}</h2>
              {editingGroupId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingGroupId('')
                    setGroupForm({ name: '', sort_order: '10' })
                  }}
                  className="text-xs font-medium text-gray-500"
                >
                  Cancelar
                </button>
              )}
            </div>

            <input
              value={groupForm.name}
              onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder={catalog.groupPlaceholder}
              required
            />
            <input
              type="number"
              min="0"
              max="9999"
              value={groupForm.sort_order}
              onChange={(event) => setGroupForm({ ...groupForm, sort_order: event.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Ordem"
              required
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50"
            >
              {editingGroupId ? 'Salvar grupo' : 'Criar grupo'}
            </button>

            <div className="divide-y divide-gray-100">
              {groups.length === 0 ? (
                <p className="py-3 text-sm text-gray-500">Nenhum grupo cadastrado.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium">{group.name}</div>
                      <div className="text-xs text-gray-500">Ordem {group.sort_order}</div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGroupId(group.id)
                          setGroupForm({
                            name: group.name,
                            sort_order: String(group.sort_order),
                          })
                        }}
                        className="text-xs font-medium text-gray-950 underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteGroup(group)}
                        disabled={actingId === group.id}
                        className="text-xs font-medium text-red-700 underline disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </form>

          <form onSubmit={saveItem} className="rounded-2xl bg-white p-5 shadow space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold">{editingItemId ? `Editar ${catalog.itemSingular}` : `Novo ${catalog.itemSingular}`}</h2>
              {editingItemId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingItemId('')
                    setForm(emptyForm)
                  }}
                  className="text-xs font-medium text-gray-500"
                >
                  Cancelar
                </button>
              )}
            </div>

            <select
              value={form.group_id}
              onChange={(event) => setForm({ ...form, group_id: event.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              <option value="">Sem grupo</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder={catalog.itemNamePlaceholder}
              required
            />
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              className="min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Descrição"
            />
            <input
              inputMode="decimal"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              onBlur={() => setForm({ ...form, price: formatMoneyInput(form.price) })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="R$ 0,00"
              required
            />
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-gray-950 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? 'Salvando...' : editingItemId ? `Salvar ${catalog.itemSingular}` : `Criar ${catalog.itemSingular}`}
            </button>
          </form>
          </div>

          <section className="rounded-2xl bg-white p-5 shadow">
            {items.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">{catalog.emptyItems}</p>
            ) : (
              <div className="space-y-5">
                {groupedItems.map((group) => (
                  <section key={group.id || 'ungrouped'}>
                    <h2 className="border-b border-gray-100 pb-2 text-sm font-bold">{group.name}</h2>
                    <div className="divide-y divide-gray-100">
                      {group.items.map((item) => (
                        <article key={item.id} className="flex items-start justify-between gap-4 py-4">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-semibold">{item.name}</div>
                            {item.description && (
                              <div className="mt-1 break-words text-sm text-gray-500">{item.description}</div>
                            )}
                            <div className="mt-2 text-sm font-bold">{formatCurrency(item.price_cents)}</div>
                          </div>

                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingItemId(item.id)
                                setForm({
                                  group_id: item.group_id ?? '',
                            name: item.name,
                            description: item.description ?? '',
                            price: formatCurrency(item.price_cents),
                          })
                              }}
                              className="text-xs font-medium text-gray-950 underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteItem(item)}
                              disabled={actingId === item.id}
                              className="text-xs font-medium text-red-700 underline disabled:opacity-50"
                            >
                              Excluir
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
