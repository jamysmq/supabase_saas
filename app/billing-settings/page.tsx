'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'

type BillingProfileRow = {
  id: string
  amount_cents: number | null
  due_day: number | null
  status: string | null
  tenant_customers: {
    id: string
    full_name: string
    is_active: boolean
  } | {
    id: string
    full_name: string
    is_active: boolean
  }[] | null
}

type BillingForm = {
  amount: string
  due_day: string
}

function firstRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null
}

function formatAmount(amountCents: number | null) {
  if (!amountCents) return ''
  return String(amountCents / 100)
}

export default function BillingSettingsPage() {
  const router = useRouter()

  const [profiles, setProfiles] = useState<BillingProfileRow[]>([])
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [editingProfileId, setEditingProfileId] = useState('')
  const [form, setForm] = useState<BillingForm>({ amount: '', due_day: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const labels = getBusinessLabels(businessType)

  const load = useCallback(async function load() {
    setLoading(true)
    setError('')
    setSuccess('')

    const result = await getCurrentTenantUser()

    if (!result) {
      router.push('/login')
      return
    }

    if (result.tenantUser.must_change_password) {
      router.push('/change-password')
      return
    }

    setBusinessType(result.tenant?.business_type ?? null)

    const { data, error: profilesError } = await supabase
      .from('customer_billing_profiles')
      .select(`
        id,
        amount_cents,
        due_day,
        status,
        tenant_customers!inner (
          id,
          full_name,
          is_active,
          tenant_id
        )
      `)
      .eq('tenant_customers.tenant_id', result.tenantUser.tenant_id)
      .eq('tenant_customers.is_active', true)
      .order('full_name', {
        referencedTable: 'tenant_customers',
        ascending: true,
      })

    if (profilesError) {
      setError('Nao foi possivel carregar as mensalidades.')
      setLoading(false)
      return
    }

    setProfiles((data ?? []) as BillingProfileRow[])
    setLoading(false)
  }, [router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  function startEdit(profile: BillingProfileRow) {
    setEditingProfileId(profile.id)
    setForm({
      amount: formatAmount(profile.amount_cents),
      due_day: profile.due_day ? String(profile.due_day) : '',
    })
    setError('')
    setSuccess('')
  }

  async function saveProfile(profileId: string) {
    setSaving(true)
    setError('')
    setSuccess('')

    const amountInCents = Math.round(Number(form.amount.replace(',', '.')) * 100)
    const dueDay = Number(form.due_day)

    if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
      setError('Informe uma mensalidade valida.')
      setSaving(false)
      return
    }

    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setError('Informe um dia de vencimento entre 1 e 31.')
      setSaving(false)
      return
    }

    const { error: updateError } = await supabase
      .from('customer_billing_profiles')
      .update({
        amount_cents: amountInCents,
        due_day: dueDay,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profileId)

    setSaving(false)

    if (updateError) {
      setError('Nao foi possivel salvar a mensalidade.')
      return
    }

    setEditingProfileId('')
    setForm({ amount: '', due_day: '' })
    setSuccess('Mensalidade atualizada.')
    await load()
  }

  function formatMoney(amountCents: number | null) {
    if (!amountCents) return '-'

    return (amountCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    })
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="max-w-5xl mx-auto space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            onClick={() => router.push('/dashboard')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <h1 className="text-2xl font-bold">Mensalidades por {labels.customerSingular.toLowerCase()}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Edite valor e vencimento individualmente, sem alterar os demais {labels.customerPluralLower}.
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-emerald-50 text-emerald-700 rounded-xl p-4 text-sm">
            {success}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">Perfis ativos</h2>
            <span className="text-sm text-gray-500">{profiles.length} perfis</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-gray-200 text-left text-gray-500">
                <tr>
                  <th className="py-3 pr-4 font-medium">{labels.customerSingular}</th>
                  <th className="py-3 pr-4 font-medium">Mensalidade</th>
                  <th className="py-3 pr-4 font-medium">Dia</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 text-right font-medium">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {profiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      Nenhum perfil de cobranca ativo encontrado.
                    </td>
                  </tr>
                ) : (
                  profiles.map((profile) => (
                    <tr key={profile.id} className="border-b border-gray-100">
                      <td className="py-3 pr-4 font-medium">
                        {firstRelation(profile.tenant_customers)?.full_name ?? '-'}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {editingProfileId === profile.id ? (
                          <input
                            value={form.amount}
                            onChange={(event) => setForm({
                              ...form,
                              amount: event.target.value,
                            })}
                            className="w-32 rounded-lg border border-gray-200 px-3 py-2"
                            inputMode="decimal"
                          />
                        ) : (
                          formatMoney(profile.amount_cents)
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {editingProfileId === profile.id ? (
                          <input
                            value={form.due_day}
                            onChange={(event) => setForm({
                              ...form,
                              due_day: event.target.value,
                            })}
                            className="w-24 rounded-lg border border-gray-200 px-3 py-2"
                            min="1"
                            max="31"
                            type="number"
                          />
                        ) : (
                          profile.due_day ?? '-'
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {profile.status ?? '-'}
                      </td>
                      <td className="py-3 text-right">
                        {editingProfileId === profile.id ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingProfileId('')}
                              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => void saveProfile(profile.id)}
                              disabled={saving}
                              className="rounded-lg bg-gray-950 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                            >
                              Salvar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(profile)}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
