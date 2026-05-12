'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../src/lib/supabase'
import { getBusinessLabels } from '../../../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../../../src/services/auth'

type Group = {
  id: string
  name: string
}

type BillingProfile = {
  id: string
  amount_cents: number | null
  due_day: number | null
  status: string | null
}

type Student = {
  id: string
  full_name: string
  cpf: string | null
  phone_e164: string
  group_id: string | null
  customer_billing_profiles: BillingProfile[]
}

type FormState = {
  full_name: string
  cpf: string
  phone: string
  group_id: string
  amount: string
  billing_day: string
}

function parseBillingFields(form: FormState) {
  const amountInCents = Math.round(Number(form.amount.replace(',', '.')) * 100)
  const billingDay = Number(form.billing_day)

  if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
    return null
  }

  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 31) {
    return null
  }

  return {
    amount_cents: amountInCents,
    due_day: billingDay,
  }
}

export default function EditStudentPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const studentId = params.id

  const [tenantId, setTenantId] = useState('')
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [student, setStudent] = useState<Student | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [form, setForm] = useState<FormState>({
    full_name: '',
    cpf: '',
    phone: '',
    group_id: '',
    amount: '',
    billing_day: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const labels = getBusinessLabels(businessType)

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

    setTenantId(result.tenantUser.tenant_id)
    setBusinessType(result.tenant?.business_type ?? null)

    const [groupsResult, studentResult] = await Promise.all([
      supabase
        .from('tenant_customer_groups')
        .select('id, name')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('tenant_customers')
        .select(`
          id,
          full_name,
          cpf,
          phone_e164,
          group_id,
          customer_billing_profiles (
            id,
            amount_cents,
            due_day,
            status
          )
        `)
        .eq('id', studentId)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .maybeSingle(),
    ])

    if (groupsResult.error || studentResult.error || !studentResult.data) {
      setError(`Nao foi possivel carregar o ${labels.customerSingular.toLowerCase()}.`)
      setLoading(false)
      return
    }

    const loadedStudent = studentResult.data as Student
    const billing = loadedStudent.customer_billing_profiles?.[0]

    setGroups((groupsResult.data ?? []) as Group[])
    setStudent(loadedStudent)
    setForm({
      full_name: loadedStudent.full_name,
      cpf: loadedStudent.cpf ?? '',
      phone: loadedStudent.phone_e164,
      group_id: loadedStudent.group_id ?? '',
      amount: billing?.amount_cents ? String(billing.amount_cents / 100) : '',
      billing_day: billing?.due_day ? String(billing.due_day) : '',
    })
    setLoading(false)
  }, [labels.customerSingular, router, studentId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function save(event: React.FormEvent) {
    event.preventDefault()

    if (!student) return

    setSaving(true)
    setError('')

    const { error: studentError } = await supabase
      .from('tenant_customers')
      .update({
        full_name: form.full_name.trim(),
        cpf: form.cpf.trim() || null,
        phone_e164: form.phone.trim(),
        group_id: form.group_id || null,
      })
      .eq('id', student.id)
      .eq('tenant_id', tenantId)

    if (studentError) {
      setError(`Nao foi possivel salvar o ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
    }

    const billing = student.customer_billing_profiles?.[0]
    const billingFields = parseBillingFields(form)

    if (!billingFields) {
      setError('Informe uma mensalidade valida e um dia de vencimento entre 1 e 31.')
      setSaving(false)
      return
    }

    if (billing?.id) {
      const { error: billingError } = await supabase
        .from('customer_billing_profiles')
        .update(billingFields)
        .eq('id', billing.id)

      if (billingError) {
        setError(`${labels.customerSingular} salvo, mas a mensalidade nao pode ser atualizada.`)
        setSaving(false)
        return
      }
    } else {
      const { error: billingError } = await supabase.rpc(
        'admin_create_billing_profile',
        {
          p_tenant_id: tenantId,
          p_customer_id: student.id,
          p_amount_cents: billingFields.amount_cents,
          p_due_day: billingFields.due_day,
          p_plan_code: null,
          p_plan_label: null,
        }
      )

      if (billingError) {
        setError(`${labels.customerSingular} salvo, mas a cobranca nao pode ser criada.`)
        setSaving(false)
        return
      }
    }

    router.push('/students')
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
      <form onSubmit={save} className="mx-auto max-w-xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            type="button"
            onClick={() => router.push('/students')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <h1 className="text-2xl font-bold">{labels.editCustomer}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Atualize cadastro, {labels.groupSingular.toLowerCase()} e dados basicos de cobranca.
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5 space-y-4">
          <label className="block text-sm font-medium">
            Nome
            <input
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
              required
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              CPF
              <input
                value={form.cpf}
                onChange={(event) => setForm({ ...form, cpf: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
              />
            </label>

            <label className="block text-sm font-medium">
              Telefone
              <input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                required
              />
            </label>
          </div>

          <label className="block text-sm font-medium">
            {labels.groupSingular}
            <select
              value={form.group_id}
              onChange={(event) => setForm({ ...form, group_id: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
            >
              <option value="">Sem {labels.groupSingular.toLowerCase()}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">
              Mensalidade
              <input
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                inputMode="decimal"
              />
            </label>

            <label className="block text-sm font-medium">
              Dia de vencimento
              <input
                value={form.billing_day}
                onChange={(event) => setForm({ ...form, billing_day: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                inputMode="numeric"
                type="number"
                min="1"
                max="31"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar alteracoes'}
          </button>
        </section>
      </form>
    </main>
  )
}
