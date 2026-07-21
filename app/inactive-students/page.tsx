'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getBusinessLabels } from '../../src/lib/business-labels'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseBilling } from '../../src/lib/plan-features'

type InactiveStudent = {
  id: string
  full_name: string
  cpf: string | null
  phone_e164: string
  group_id: string | null
  tenant_customer_groups: {
    id: string
    name: string
  } | {
    id: string
    name: string
  }[] | null
}

function firstRelation<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null
}

export function InactiveStudentsPanel({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter()

  const [students, setStudents] = useState<InactiveStudent[]>([])
  const [businessType, setBusinessType] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [reactivatingStudentId, setReactivatingStudentId] = useState('')
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

    const { data, error: studentsError } = await supabase
      .from('tenant_customers')
      .select(`
        id,
        full_name,
        cpf,
        phone_e164,
        group_id,
        tenant_customer_groups (
          id,
          name
        )
      `)
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', false)
      .order('full_name', { ascending: true })

    if (studentsError) {
      setError(`Não foi possível carregar ${labels.customerPluralLower} inativos.`)
      setLoading(false)
      return
    }

    setStudents((data ?? []) as InactiveStudent[])
    setLoading(false)
  }, [labels.customerPluralLower, router])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const filteredStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) return students

    return students.filter((student) => (
      student.full_name.toLowerCase().includes(normalizedQuery) ||
      student.phone_e164.toLowerCase().includes(normalizedQuery) ||
      (student.cpf ?? '').toLowerCase().includes(normalizedQuery)
    ))
  }, [students, query])

  async function reactivateStudent(student: InactiveStudent) {
    const confirmed = confirm(`Reativar ${student.full_name}?`)
    if (!confirmed) return

    setReactivatingStudentId(student.id)
    setError('')

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      setReactivatingStudentId('')
      router.push('/login')
      return
    }

    const response = await fetch(`/api/tenant-customers/${student.id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: true }),
    })

    setReactivatingStudentId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || `Não foi possível reativar o ${labels.customerSingular.toLowerCase()}.`)
      return
    }

    await load()
  }

  if (loading) {
    return (
      <div className={embedded ? 'py-10 text-center' : 'min-h-screen flex items-center justify-center bg-gray-100'}>
        Carregando...
      </div>
    )
  }

  return (
    <div className={embedded ? 'text-gray-950' : 'min-h-screen bg-gray-100 px-4 py-6 text-gray-950'}>
      <div className={embedded ? 'space-y-4' : 'max-w-4xl mx-auto space-y-4'}>
        <section className="bg-white rounded-2xl shadow p-5">
          {!embedded && <button
            onClick={() => router.push('/students')}
            className="text-sm text-gray-500 mb-3"
          >
            Voltar ao gerenciamento dos alunos
          </button>}

          <h1 className={embedded ? 'text-lg font-bold' : 'text-2xl font-bold'}>{labels.inactiveCustomers}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Consulte e reative {labels.customerPluralLower} sem perder o cadastro existente.
          </p>
        </section>

        {error && (
          <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        <section className="bg-white rounded-2xl shadow p-5 space-y-4">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="Buscar por nome, CPF ou telefone"
          />

          <div className="divide-y divide-gray-100">
            {filteredStudents.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">
                Nenhum {labels.customerSingular.toLowerCase()} inativo encontrado.
              </p>
            ) : (
              filteredStudents.map((student) => (
                <div
                  key={student.id}
                  className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <h2 className="font-medium">{student.full_name}</h2>
                    <p className="text-sm text-gray-500">
                      {student.phone_e164 || 'Sem telefone'} · {firstRelation(student.tenant_customer_groups)?.name || `Sem ${labels.groupSingular.toLowerCase()}`}
                    </p>
                  </div>

                  <button
                    onClick={() => void reactivateStudent(student)}
                    disabled={reactivatingStudentId === student.id}
                    className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
                  >
                    {reactivatingStudentId === student.id ? 'Reativando...' : 'Reativar'}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default function InactiveStudentsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/students') }, [router])
  return <main className="min-h-screen bg-gray-100 p-6 text-center">Abrindo o gerenciamento dos alunos...</main>
}
