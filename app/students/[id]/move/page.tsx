'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '../../../../src/lib/supabase'
import { getBusinessLabels } from '../../../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../../../src/services/auth'
import { tenantCanUseBilling } from '../../../../src/lib/plan-features'

type Group = {
  id: string
  name: string
}

type Student = {
  id: string
  full_name: string
  group_id: string | null
}

export default function MoveStudentPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const studentId = params.id

  const [student, setStudent] = useState<Student | null>(null)
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [groupId, setGroupId] = useState('')
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

    if (!tenantCanUseBilling(result.tenant?.plan)) {
      router.push('/dashboard')
      return
    }

    setBusinessType(result.tenant?.business_type ?? null)

    const [groupsResult, studentResult] = await Promise.all([
      supabase
        .from('tenant_customer_groups')
        .select('id, name')
        .eq('tenant_id', result.tenantUser.tenant_id)
        .order('name', { ascending: true }),
      supabase
        .from('tenant_customers')
        .select('id, full_name, group_id')
        .eq('id', studentId)
        .eq('tenant_id', result.tenantUser.tenant_id)
        .maybeSingle(),
    ])

    if (groupsResult.error || studentResult.error || !studentResult.data) {
      setError(`Não foi possível carregar o ${labels.customerSingular.toLowerCase()}.`)
      setLoading(false)
      return
    }

    const loadedStudent = studentResult.data as Student

    setGroups((groupsResult.data ?? []) as Group[])
    setStudent(loadedStudent)
    setGroupId(loadedStudent.group_id ?? '')
    setLoading(false)
  }, [labels.customerSingular, router, studentId])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  async function moveStudent(event: React.FormEvent) {
    event.preventDefault()

    if (!student) return

    setSaving(true)
    setError('')

    const { error: moveError } = await supabase.rpc(
      'admin_move_customer_to_group',
      {
        p_customer_id: student.id,
        p_group_id: groupId || null,
      }
    )

    if (moveError) {
      setError(`Não foi possível mover o ${labels.customerSingular.toLowerCase()}.`)
      setSaving(false)
      return
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
      <form onSubmit={moveStudent} className="mx-auto max-w-md space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <button
            type="button"
            onClick={() => router.push('/students')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar
          </button>

          <h1 className="text-2xl font-bold">Mover {labels.customerSingular.toLowerCase()}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {student?.full_name}
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5 space-y-4">
          <label className="block text-sm font-medium">
            Nova {labels.groupSingular.toLowerCase()}
            <select
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
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

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Movendo...' : `Mover ${labels.customerSingular.toLowerCase()}`}
          </button>
        </section>
      </form>
    </main>
  )
}
