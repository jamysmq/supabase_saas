'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseAppointments } from '../../src/lib/plan-features'
import { formatCurrencyFromCents, formatMoneyInput } from '../../src/lib/money'

type Appointment = {
  appointment_id: string
  tenant_customer_id: string | null
  end_customer_id: string | null
  customer_name: string | null
  customer_cpf: string | null
  customer_phone_e164: string | null
  customer_birth_date: string | null
  service_id: string | null
  service_name: string | null
  staff_member_id: string | null
  staff_member_name: string | null
  starts_at: string
  ends_at: string
  status: string
  title: string | null
  notes: string | null
  source: string
}

type Service = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price_cents: number | null
}

type ServiceForm = {
  name: string
  description: string
  duration_minutes: string
  price: string
}

type StaffMember = {
  id: string
  name: string
  role: string | null
}

type AppointmentForm = {
  full_name: string
  cpf: string
  whatsapp_e164: string
  birth_date: string
  service_id: string
  staff_member_id: string
  date: string
  time: string
  duration_minutes: string
  title: string
  notes: string
}

const emptyAppointmentForm: AppointmentForm = {
  full_name: '',
  cpf: '',
  whatsapp_e164: '',
  birth_date: '',
  service_id: '',
  staff_member_id: '',
  date: new Date().toISOString().slice(0, 10),
  time: '09:00',
  duration_minutes: '60',
  title: '',
  notes: '',
}

function getDayBounds(date: string) {
  const from = new Date(`${date}T00:00:00`)
  const to = new Date(`${date}T00:00:00`)
  to.setDate(to.getDate() + 1)

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(valueCents: number | null | undefined) {
  return valueCents === null || valueCents === undefined
    ? formatCurrencyFromCents(0)
    : formatCurrencyFromCents(valueCents)
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    scheduled: 'Agendado',
    confirmed: 'Confirmado',
    completed: 'Concluido',
    cancelled: 'Cancelado',
    no_show: 'Faltou',
  }

  return labels[status] ?? status
}

export default function AppointmentsPage() {
  const router = useRouter()

  const [businessType, setBusinessType] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(emptyAppointmentForm)
  const [serviceForm, setServiceForm] = useState<ServiceForm>({
    name: '',
    description: '',
    duration_minutes: '60',
    price: '',
  })
  const [editingServiceId, setEditingServiceId] = useState('')
  const [staffForm, setStaffForm] = useState({ name: '', role: '' })
  const [editingStaffId, setEditingStaffId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actingId, setActingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const appointmentPersonLabel = businessType === 'clinic'
    ? 'Paciente'
    : 'Pessoa'

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

    if (!tenantCanUseAppointments(result.tenant?.plan)) {
      router.push('/dashboard')
      return
    }

    setBusinessType(result.tenant?.business_type ?? null)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session) {
      router.push('/login')
      return
    }

    const { from, to } = getDayBounds(selectedDate)
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
    }

    const [appointmentsResponse, servicesResponse, staffResponse] =
      await Promise.all([
        fetch(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
        fetch('/api/appointment-services', { headers }),
        fetch('/api/appointment-staff', { headers }),
      ])

    if (!appointmentsResponse.ok || !servicesResponse.ok || !staffResponse.ok) {
      setError('Não foi possível carregar a agenda.')
      setLoading(false)
      return
    }

    const appointmentsData = await appointmentsResponse.json()
    const servicesData = await servicesResponse.json()
    const staffData = await staffResponse.json()

    setAppointments(appointmentsData.appointments ?? [])
    setServices(servicesData.services ?? [])
    setStaff(staffData.staff ?? [])
    setLoading(false)
  }, [router, selectedDate])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [load])

  const appointmentStats = useMemo(() => {
    return {
      total: appointments.length,
      active: appointments.filter((appointment) => appointment.status !== 'cancelled').length,
      confirmed: appointments.filter((appointment) => appointment.status === 'confirmed').length,
    }
  }, [appointments])

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token ?? ''
  }

  function selectService(serviceId: string) {
    const service = services.find((item) => item.id === serviceId)

    setAppointmentForm({
      ...appointmentForm,
      service_id: serviceId,
      duration_minutes: service ? String(service.duration_minutes) : appointmentForm.duration_minutes,
    })
  }

  async function createAppointment(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    const startsAt = new Date(`${appointmentForm.date}T${appointmentForm.time}:00`)
    const endsAt = new Date(startsAt)
    endsAt.setMinutes(endsAt.getMinutes() + Number(appointmentForm.duration_minutes || 60))

    const response = await fetch('/api/appointments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        full_name: appointmentForm.full_name,
        cpf: appointmentForm.cpf,
        whatsapp_e164: appointmentForm.whatsapp_e164,
        birth_date: appointmentForm.birth_date,
        service_id: appointmentForm.service_id || null,
        staff_member_id: appointmentForm.staff_member_id || null,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        title: appointmentForm.title,
        notes: appointmentForm.notes,
      }),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível criar o agendamento.')
      return
    }

    setSuccess('Agendamento criado.')
    setAppointmentForm({ ...emptyAppointmentForm, date: appointmentForm.date })
    await load()
  }

  async function saveService(event: React.FormEvent) {
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
      editingServiceId
        ? `/api/appointment-services/${editingServiceId}`
        : '/api/appointment-services',
      {
        method: editingServiceId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serviceForm),
      }
    )

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível salvar o serviço.')
      return
    }

    setSuccess(editingServiceId ? 'Serviço atualizado.' : 'Serviço criado.')
    setServiceForm({ name: '', description: '', duration_minutes: '60', price: '' })
    setEditingServiceId('')
    await load()
  }

  async function saveStaff(event: React.FormEvent) {
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
      editingStaffId
        ? `/api/appointment-staff/${editingStaffId}`
        : '/api/appointment-staff',
      {
        method: editingStaffId ? 'PATCH' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(staffForm),
      }
    )

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível salvar o profissional.')
      return
    }

    setSuccess(editingStaffId ? 'Profissional atualizado.' : 'Profissional criado.')
    setStaffForm({ name: '', role: '' })
    setEditingStaffId('')
    await load()
  }

  async function deleteService(service: Service) {
    const confirmed = confirm(`Excluir o serviço ${service.name}?`)
    if (!confirmed) return

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setActingId(service.id)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/appointment-services/${service.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível excluir o serviço.')
      return
    }

    if (editingServiceId === service.id) {
      setEditingServiceId('')
      setServiceForm({ name: '', description: '', duration_minutes: '60', price: '' })
    }

    setSuccess('Serviço excluído.')
    await load()
  }

  async function deleteStaff(member: StaffMember) {
    const confirmed = confirm(`Excluir o profissional ${member.name}?`)
    if (!confirmed) return

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setActingId(member.id)
    setError('')
    setSuccess('')

    const response = await fetch(`/api/appointment-staff/${member.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    setActingId('')

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível excluir o profissional.')
      return
    }

    if (editingStaffId === member.id) {
      setEditingStaffId('')
      setStaffForm({ name: '', role: '' })
    }

    setSuccess('Profissional excluído.')
    await load()
  }

  async function updateStatus(appointment: Appointment, status: string) {
    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setError('')
    setSuccess('')
    setActingId(appointment.appointment_id)

    const response = await fetch(`/api/appointments/${appointment.appointment_id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível alterar o status.')
      setActingId('')
      return
    }

    setSuccess('Status atualizado.')
    setActingId('')
    await load()
  }

  async function deleteAppointment(appointment: Appointment) {
    const confirmed = window.confirm('Excluir este agendamento?')

    if (!confirmed) {
      return
    }

    const token = await getToken()

    if (!token) {
      router.push('/login')
      return
    }

    setError('')
    setSuccess('')
    setActingId(appointment.appointment_id)

    const response = await fetch(`/api/appointments/${appointment.appointment_id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível excluir o agendamento.')
      setActingId('')
      return
    }

    setSuccess('Agendamento excluído.')
    setActingId('')
    await load()
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 text-gray-950">
        Carregando...
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-6 text-gray-950">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="bg-white rounded-2xl shadow p-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-sm text-gray-500"
            >
              Voltar
            </button>
            <button
              onClick={() => router.push('/appointment-history?from=appointments')}
              className="text-sm font-medium text-gray-950 underline"
            >
              Histórico
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div className="space-y-4">
              <h1 className="text-2xl font-bold">Agenda</h1>
              <p className="text-sm text-gray-500 mt-1">
                Organize atendimentos, consultas e horários por profissional.
              </p>
              <label className="block max-w-xs text-sm font-medium">
                Dia da agenda
                <input
                  value={selectedDate}
                  onChange={(event) => {
                    setSelectedDate(event.target.value)
                    setAppointmentForm({ ...appointmentForm, date: event.target.value })
                  }}
                  className="mt-1 h-11 w-full rounded-lg border border-gray-200 px-3 text-base font-normal"
                  type="date"
                />
              </label>
            </div>
          </div>
        </section>

        {error && (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_460px]">
          <div className="space-y-4">
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-5 shadow">
                <p className="text-sm text-gray-500">Agendamentos</p>
                <p className="mt-1 text-2xl font-bold">{appointmentStats.total}</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow">
                <p className="text-sm text-gray-500">Ativos</p>
                <p className="mt-1 text-2xl font-bold">{appointmentStats.active}</p>
              </div>
              <div className="rounded-2xl bg-white p-5 shadow">
                <p className="text-sm text-gray-500">Confirmados</p>
                <p className="mt-1 text-2xl font-bold">{appointmentStats.confirmed}</p>
              </div>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-bold">Horários do dia</h2>
                <span className="text-sm text-gray-500">
                  {new Date(`${selectedDate}T00:00:00`).toLocaleDateString('pt-BR')}
                </span>
              </div>

              <div className="divide-y divide-gray-100">
                {appointments.length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-500">
                    Nenhum agendamento neste dia.
                  </p>
                ) : (
                  appointments.map((appointment) => (
                    <div
                      key={appointment.appointment_id}
                      className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="font-bold">
                          {formatTime(appointment.starts_at)} - {formatTime(appointment.ends_at)}
                        </div>
                        <div className="mt-1 break-words text-sm font-medium">
                          {appointment.customer_name || appointment.title || 'Sem pessoa'}
                        </div>
                        <div className="break-words text-sm text-gray-500">
                          {appointment.customer_phone_e164 || 'Sem WhatsApp'} · {appointment.service_name || 'Sem serviço'} · {appointment.staff_member_name || 'Sem profissional'}
                        </div>
                        {appointment.notes && (
                          <div className="mt-1 break-words text-xs text-gray-500">
                            {appointment.notes}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] md:flex md:flex-col md:items-end">
                        <select
                          value={appointment.status}
                          onChange={(event) => void updateStatus(appointment, event.target.value)}
                          disabled={actingId === appointment.appointment_id}
                          className="h-10 w-full rounded-lg border border-gray-200 px-2 text-sm disabled:bg-gray-100 md:w-44"
                        >
                          <option value="scheduled">Agendado</option>
                          <option value="confirmed">Confirmado</option>
                          <option value="completed">Concluido</option>
                          <option value="cancelled">Cancelado</option>
                          <option value="no_show">Faltou</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => void deleteAppointment(appointment)}
                          disabled={actingId === appointment.appointment_id}
                          className="h-10 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-700 disabled:opacity-60 md:w-44"
                        >
                          Excluir
                        </button>
                        <span className="text-xs font-medium text-gray-500 md:text-right">
                          {statusLabel(appointment.status)}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <form onSubmit={createAppointment} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <h2 className="font-bold">Novo agendamento</h2>

              <label className="block text-sm font-medium">
                Nome completo
                <input
                  value={appointmentForm.full_name}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, full_name: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                  placeholder={`Nome da ${appointmentPersonLabel.toLowerCase()}`}
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  CPF
                  <input
                    value={appointmentForm.cpf}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, cpf: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    inputMode="numeric"
                    placeholder="00000000000"
                    required
                  />
                </label>

                <label className="text-sm font-medium">
                  WhatsApp
                  <input
                    value={appointmentForm.whatsapp_e164}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, whatsapp_e164: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    inputMode="numeric"
                    placeholder="83999999999"
                    required
                  />
                </label>

                <label className="text-sm font-medium sm:col-span-2">
                  Nascimento
                  <input
                    value={appointmentForm.birth_date}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, birth_date: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="date"
                    required
                  />
                </label>
              </div>

              <label className="block text-sm font-medium">
                Serviço
                <select
                  value={appointmentForm.service_id}
                  onChange={(event) => selectService(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                >
                  <option value="">Sem serviço</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                Profissional
                <select
                  value={appointmentForm.staff_member_id}
                  onChange={(event) => setAppointmentForm({ ...appointmentForm, staff_member_id: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                >
                  <option value="">Sem profissional</option>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm font-medium">
                  Data
                  <input
                    value={appointmentForm.date}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, date: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="date"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Hora
                  <input
                    value={appointmentForm.time}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, time: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="time"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Min
                  <input
                    value={appointmentForm.duration_minutes}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, duration_minutes: event.target.value })}
                    className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    min="1"
                    type="number"
                    required
                  />
                </label>
              </div>

              <input
                value={appointmentForm.title}
                onChange={(event) => setAppointmentForm({ ...appointmentForm, title: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Titulo opcional"
              />

              <textarea
                value={appointmentForm.notes}
                onChange={(event) => setAppointmentForm({ ...appointmentForm, notes: event.target.value })}
                className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Observações"
              />

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-gray-950 py-2 font-medium text-white disabled:opacity-50"
              >
                {saving ? 'Salvando...' : 'Criar agendamento'}
              </button>
            </form>

            <form onSubmit={saveService} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Serviços</h2>
                {editingServiceId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingServiceId('')
                      setServiceForm({ name: '', description: '', duration_minutes: '60', price: '' })
                    }}
                    className="text-xs font-medium text-gray-500"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              <input
                value={serviceForm.name}
                onChange={(event) => setServiceForm({ ...serviceForm, name: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Nome do serviço"
                required
              />
              <textarea
                value={serviceForm.description}
                onChange={(event) => setServiceForm({ ...serviceForm, description: event.target.value })}
                className="min-h-20 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Descrição"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="number"
                  min="15"
                  max="480"
                  step="15"
                  value={serviceForm.duration_minutes}
                  onChange={(event) => setServiceForm({ ...serviceForm, duration_minutes: event.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="Duracao em minutos"
                  required
                />
                <input
                  inputMode="decimal"
                  value={serviceForm.price}
                  onChange={(event) => setServiceForm({ ...serviceForm, price: event.target.value })}
                  onBlur={() => setServiceForm({ ...serviceForm, price: formatMoneyInput(serviceForm.price) })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  placeholder="R$ 0,00"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50"
              >
                {editingServiceId ? 'Salvar serviço' : 'Criar serviço'}
              </button>

              <div className="divide-y divide-gray-100">
                {services.length === 0 ? (
                  <p className="py-3 text-sm text-gray-500">Nenhum serviço cadastrado.</p>
                ) : (
                  services.map((service) => (
                    <div key={service.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium">{service.name}</div>
                        <div className="mt-1 text-xs text-gray-500">
                          {service.duration_minutes} min · {formatCurrency(service.price_cents)}
                        </div>
                        {service.description && (
                          <div className="mt-1 break-words text-xs text-gray-500">{service.description}</div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingServiceId(service.id)
                            setServiceForm({
                              name: service.name,
                              description: service.description ?? '',
                              duration_minutes: String(service.duration_minutes ?? 60),
                              price: service.price_cents ? formatCurrencyFromCents(service.price_cents) : '',
                            })
                          }}
                          className="text-xs font-medium text-gray-950 underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteService(service)}
                          disabled={actingId === service.id}
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

            <form onSubmit={saveStaff} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Profissionais</h2>
                {editingStaffId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingStaffId('')
                      setStaffForm({ name: '', role: '' })
                    }}
                    className="text-xs font-medium text-gray-500"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              <input
                value={staffForm.name}
                onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Nome"
                required
              />
              <input
                value={staffForm.role}
                onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Observações"
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50"
              >
                {editingStaffId ? 'Salvar profissional' : 'Criar profissional'}
              </button>

              <div className="divide-y divide-gray-100">
                {staff.length === 0 ? (
                  <p className="py-3 text-sm text-gray-500">Nenhum profissional cadastrado.</p>
                ) : (
                  staff.map((member) => (
                    <div key={member.id} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium">{member.name}</div>
                        {member.role && (
                          <div className="break-words text-xs text-gray-500">{member.role}</div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingStaffId(member.id)
                            setStaffForm({
                              name: member.name,
                              role: member.role ?? '',
                            })
                          }}
                          className="text-xs font-medium text-gray-950 underline"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteStaff(member)}
                          disabled={actingId === member.id}
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
          </aside>
        </section>
      </div>
    </main>
  )
}
