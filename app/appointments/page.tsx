'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../src/lib/supabase'
import { getCurrentTenantUser } from '../../src/services/auth'
import { tenantCanUseAppointments } from '../../src/lib/plan-features'
import { formatCurrencyFromCents, formatMoneyInput } from '../../src/lib/money'
import { openNativePicker } from '../../src/lib/open-native-picker'

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
  staff_member_ids: string[]
}

type ServiceForm = {
  name: string
  description: string
  duration_minutes: string
  price: string
  staff_member_ids: string[]
}

type StaffMember = {
  id: string
  name: string
  role: string | null
}

type PendingStaffRequest = {
  id: string
  name: string
  role: string | null
  status: string
  additional_amount_cents: number
  created_at: string
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

type AppointmentSettingsForm = {
  opens_at: string
  closes_at: string
  working_weekdays: number[]
  has_break: boolean
  break_starts_at: string
  break_duration_minutes: string
  timezone: string
}

type AppointmentBlock = {
  id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

type AppointmentBlockForm = {
  starts_at: string
  ends_at: string
  reason: string
}

const defaultAppointmentSettings: AppointmentSettingsForm = {
  opens_at: '08:00',
  closes_at: '18:00',
  working_weekdays: [1, 2, 3, 4, 5],
  has_break: false,
  break_starts_at: '12:00',
  break_duration_minutes: '60',
  timezone: 'America/Fortaleza',
}

const weekdayOptions = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 7, label: 'Dom' },
]

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

const emptyAppointmentBlockForm: AppointmentBlockForm = {
  starts_at: '',
  ends_at: '',
  reason: '',
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
    completed: 'Concluído',
    cancelled: 'Cancelado',
    no_show: 'Faltou',
  }

  return labels[status] ?? status
}

const appointmentStatusOptions = [
  { value: 'scheduled', label: 'Agendado' },
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'no_show', label: 'Faltou' },
]

function statusTone(status: string) {
  const tones: Record<string, string> = {
    scheduled: 'border-sky-200 bg-sky-50 text-sky-800',
    confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    completed: 'border-slate-200 bg-slate-50 text-slate-700',
    cancelled: 'border-red-200 bg-red-50 text-red-700',
    no_show: 'border-amber-200 bg-amber-50 text-amber-800',
  }

  return tones[status] ?? tones.scheduled
}

export default function AppointmentsPage() {
  const router = useRouter()

  const [businessType, setBusinessType] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [outcomeQueue, setOutcomeQueue] = useState<Appointment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [pendingStaffRequests, setPendingStaffRequests] = useState<PendingStaffRequest[]>([])
  const [appointmentForm, setAppointmentForm] = useState<AppointmentForm>(emptyAppointmentForm)
  const [serviceForm, setServiceForm] = useState<ServiceForm>({
    name: '',
    description: '',
    duration_minutes: '',
    price: '',
    staff_member_ids: [],
  })
  const [appointmentSettingsForm, setAppointmentSettingsForm] = useState<AppointmentSettingsForm>(defaultAppointmentSettings)
  const [appointmentBlocks, setAppointmentBlocks] = useState<AppointmentBlock[]>([])
  const [appointmentBlockForm, setAppointmentBlockForm] = useState<AppointmentBlockForm>(emptyAppointmentBlockForm)
  const [editingServiceId, setEditingServiceId] = useState('')
  const [staffForm, setStaffForm] = useState({ name: '', role: '' })
  const [editingStaffId, setEditingStaffId] = useState('')
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false)
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false)
  const [isOutcomeQueueOpen, setIsOutcomeQueueOpen] = useState(false)
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

    const [appointmentsResponse, servicesResponse, staffResponse, settingsResponse, blocksResponse, outcomeQueueResponse] =
      await Promise.all([
        fetch(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
        fetch('/api/appointment-services', { headers }),
        fetch('/api/appointment-staff', { headers }),
        fetch('/api/tenant-appointment-settings', { headers }),
        fetch('/api/tenant-appointment-blocks', { headers }),
        fetch('/api/appointments/outcome-queue', { headers }),
      ])

    if (!appointmentsResponse.ok || !servicesResponse.ok || !staffResponse.ok || !settingsResponse.ok || !blocksResponse.ok || !outcomeQueueResponse.ok) {
      setError('Não foi possível carregar a agenda.')
      setLoading(false)
      return
    }

    const appointmentsData = await appointmentsResponse.json()
    const servicesData = await servicesResponse.json()
    const staffData = await staffResponse.json()
    const settingsData = await settingsResponse.json()
    const blocksData = await blocksResponse.json()
    const outcomeQueueData = await outcomeQueueResponse.json()

    setAppointments(appointmentsData.appointments ?? [])
    setServices(servicesData.services ?? [])
    setStaff(staffData.staff ?? [])
    setPendingStaffRequests(staffData.pendingRequests ?? [])
    setAppointmentBlocks(blocksData.blocks ?? [])
    const pendingOutcomes = outcomeQueueData.appointments ?? []
    setOutcomeQueue(pendingOutcomes)
    setIsOutcomeQueueOpen(pendingOutcomes.length > 0)
    setAppointmentSettingsForm({
      ...defaultAppointmentSettings,
      ...(settingsData.settings ?? {}),
      break_duration_minutes: String(settingsData.settings?.break_duration_minutes ?? defaultAppointmentSettings.break_duration_minutes),
    })
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

  const appointmentStaff = useMemo(() => {
    const selectedService = services.find((service) => service.id === appointmentForm.service_id)

    if (!selectedService) return []

    return staff.filter((member) => selectedService.staff_member_ids.includes(member.id))
  }, [appointmentForm.service_id, services, staff])

  async function getToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    return session?.access_token ?? ''
  }

  function resetServiceForm() {
    setServiceForm({ name: '', description: '', duration_minutes: '', price: '', staff_member_ids: [] })
    setEditingServiceId('')
  }

  function openNewServiceModal() {
    resetServiceForm()
    setIsServiceModalOpen(true)
  }

  function openEditServiceModal(service: Service) {
    setEditingServiceId(service.id)
    setServiceForm({
      name: service.name,
      description: service.description ?? '',
      duration_minutes: String(service.duration_minutes ?? 60),
      price: service.price_cents ? formatCurrencyFromCents(service.price_cents) : '',
      staff_member_ids: service.staff_member_ids,
    })
    setIsServiceModalOpen(true)
  }

  function closeServiceModal() {
    setIsServiceModalOpen(false)
    resetServiceForm()
  }

  function resetStaffForm() {
    setStaffForm({ name: '', role: '' })
    setEditingStaffId('')
  }

  function openNewStaffModal() {
    resetStaffForm()
    setIsStaffModalOpen(true)
  }

  function openEditStaffModal(member: StaffMember) {
    setEditingStaffId(member.id)
    setStaffForm({
      name: member.name,
      role: member.role ?? '',
    })
    setIsStaffModalOpen(true)
  }

  function closeStaffModal() {
    setIsStaffModalOpen(false)
    resetStaffForm()
  }

  async function saveAppointmentSettings(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = await getToken()

    if (!token) {
      setSaving(false)
      router.push('/login')
      return
    }

    const response = await fetch('/api/tenant-appointment-settings', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...appointmentSettingsForm,
        break_duration_minutes: Number(appointmentSettingsForm.break_duration_minutes),
      }),
    })

    setSaving(false)

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível salvar os horários de funcionamento.')
      return
    }

    const data = await response.json()
    setAppointmentSettingsForm({
      ...defaultAppointmentSettings,
      ...(data.settings ?? {}),
      break_duration_minutes: String(data.settings?.break_duration_minutes ?? defaultAppointmentSettings.break_duration_minutes),
    })
    setSuccess('Horários de funcionamento salvos.')
  }

  async function createAppointmentBlock(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    const startsAt = new Date(appointmentBlockForm.starts_at)
    const endsAt = new Date(appointmentBlockForm.ends_at)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      setError('Informe um início e um fim válidos para o bloqueio.')
      setSaving(false)
      return
    }
    const token = await getToken()
    if (!token) { setSaving(false); router.push('/login'); return }
    const response = await fetch('/api/tenant-appointment-blocks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: appointmentBlockForm.reason }),
    })
    setSaving(false)
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível bloquear esse período.')
      return
    }
    setAppointmentBlockForm(emptyAppointmentBlockForm)
    setSuccess('Período bloqueado. Novos agendamentos não serão aceitos nesse intervalo.')
    await load()
  }

  async function deleteAppointmentBlock(block: AppointmentBlock) {
    if (!window.confirm('Liberar novamente este período da agenda?')) return
    setActingId(block.id)
    setError('')
    setSuccess('')
    const token = await getToken()
    if (!token) { setActingId(''); router.push('/login'); return }
    const response = await fetch(`/api/tenant-appointment-blocks?id=${encodeURIComponent(block.id)}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    })
    setActingId('')
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.message || 'Não foi possível liberar esse período.')
      return
    }
    setSuccess('Período liberado novamente.')
    await load()
  }

  function selectService(serviceId: string) {
    const service = services.find((item) => item.id === serviceId)
    const selectedStaffIds = service?.staff_member_ids ?? []
    const nextStaffMemberId = selectedStaffIds.includes(appointmentForm.staff_member_id)
      ? appointmentForm.staff_member_id
      : selectedStaffIds.length === 1
        ? selectedStaffIds[0]
        : ''

    setAppointmentForm({
      ...appointmentForm,
      service_id: serviceId,
      staff_member_id: nextStaffMemberId,
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

    if (!appointmentForm.service_id) {
      setSaving(false)
      setError('Selecione o serviço.')
      return
    }

    if (!appointmentForm.staff_member_id) {
      setSaving(false)
      setError('Selecione o profissional.')
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

    if (serviceForm.staff_member_ids.length === 0) {
      setSaving(false)
      setError('Selecione pelo menos um profissional para o serviço.')
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
    closeServiceModal()
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

    const data = await response.json()
    setSuccess(
      editingStaffId
        ? 'Profissional atualizado.'
        : data.pendingApproval
          ? 'Solicitação enviada à Soft Ink. O profissional será liberado após a aprovação e acrescentará R$ 25,00 à mensalidade.'
          : 'Primeiro profissional criado e incluído na mensalidade.'
    )
    closeStaffModal()
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
      closeServiceModal()
    }

    setSuccess('Serviço excluído.')
    await load()
  }

  async function deleteStaff(member: StaffMember) {
    const confirmed = confirm(
      `Excluir o profissional ${member.name}?\n\n` +
      'Ele será removido imediatamente da agenda, mas o histórico será preservado. ' +
      'Se esteve ativo por mais de 15 dias, o adicional de R$ 25,00 será cobrado uma última vez na próxima mensalidade. ' +
      'Agendamentos futuros precisam ser movidos ou cancelados antes da exclusão.'
    )
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

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      setError(data?.message || 'Não foi possível excluir o profissional.')
      return
    }

    if (editingStaffId === member.id) {
      closeStaffModal()
    }

    setSuccess(data?.message || 'Profissional excluído.')
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

    const successMessages: Record<string, string> = {
      completed: 'Serviço concluído e lançado no histórico financeiro.',
      no_show: 'Falta registrada. Nenhuma receita foi lançada.',
      cancelled: 'Cancelamento registrado. Nenhuma receita foi lançada.',
      confirmed: 'Agendamento confirmado. A receita só será lançada após a conclusão do serviço.',
      scheduled: 'Agendamento voltou para o status agendado.',
    }
    setSuccess(successMessages[status] ?? 'Status atualizado.')
    setActingId('')
    await load()
  }

  function renderStatusControl(appointment: Appointment) {
    const isUpdating = actingId === appointment.appointment_id

    return (
      <details className="group relative w-full">
        <summary
          onClick={(event) => {
            if (isUpdating) event.preventDefault()
          }}
          aria-disabled={isUpdating}
          className={`flex h-9 w-full list-none items-center justify-between gap-2 rounded-lg border px-3 text-xs font-semibold shadow-sm transition hover:brightness-[0.98] [&::-webkit-details-marker]:hidden ${statusTone(appointment.status)} ${isUpdating ? 'cursor-wait opacity-60' : ''}`}
        >
          <span className="truncate">{isUpdating ? 'Salvando...' : statusLabel(appointment.status)}</span>
          <span aria-hidden="true" className="text-[10px] transition group-open:rotate-180">▼</span>
        </summary>

        <div className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
          {appointmentStatusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={(event) => {
                event.currentTarget.closest('details')?.removeAttribute('open')
                if (option.value !== appointment.status) void updateStatus(appointment, option.value)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium hover:bg-gray-50 ${option.value === appointment.status ? 'text-gray-950' : 'text-gray-600'}`}
            >
              <span>{option.label}</span>
              {option.value === appointment.status && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </details>
    )
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
            <button
              type="button"
              onClick={() => setIsOutcomeQueueOpen(true)}
              className={
                outcomeQueue.length > 0
                  ? 'rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-900'
                  : 'rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-500'
              }
            >
              Atendimentos a confirmar
              {outcomeQueue.length > 0 ? ` (${outcomeQueue.length})` : ''}
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
                  className="mt-1 h-11 w-full cursor-pointer rounded-lg border border-gray-200 px-3 text-base font-normal"
                  type="date"
                  onClick={openNativePicker}
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

        <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-4">
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 shadow">
                <p className="text-sm text-gray-500">Agendamentos</p>
                <p className="mt-1 text-2xl font-bold">{appointmentStats.total}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow">
                <p className="text-sm text-gray-500">Ativos</p>
                <p className="mt-1 text-2xl font-bold">{appointmentStats.active}</p>
              </div>
              <div className="rounded-2xl bg-white p-4 shadow">
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
                  <>
                    <div className="space-y-3 md:hidden">
                      {appointments.map((appointment) => (
                        <article key={appointment.appointment_id} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold">{formatTime(appointment.starts_at)} – {formatTime(appointment.ends_at)}</p>
                              <p className="mt-1 truncate text-sm font-medium">
                                {appointment.customer_name || appointment.title || 'Sem pessoa'}
                              </p>
                              <p className="truncate text-xs text-gray-500">
                                {appointment.customer_phone_e164 || 'Sem contato'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void deleteAppointment(appointment)}
                              disabled={actingId === appointment.appointment_id}
                              className="h-9 shrink-0 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-60"
                            >
                              Excluir
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_130px] items-end gap-3">
                            <div className="min-w-0 text-xs text-gray-600">
                              <p className="truncate font-medium">{appointment.service_name || 'Sem serviço'}</p>
                              <p className="truncate">
                                {appointment.staff_member_name ? `com ${appointment.staff_member_name}` : 'Profissional não definido'}
                              </p>
                            </div>
                            {renderStatusControl(appointment)}
                          </div>
                        </article>
                      ))}
                    </div>

                  <div className="hidden md:block">
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col className="w-[17%]" />
                        <col className="w-[29%]" />
                        <col className="w-[26%]" />
                        <col className="w-[14%]" />
                        <col className="w-[14%]" />
                      </colgroup>
                      <thead className="border-b border-gray-200 text-left text-xs text-gray-500">
                        <tr>
                          <th className="py-2.5 pr-3 font-semibold">Horário</th>
                          <th className="py-2.5 pr-3 font-semibold">Cliente</th>
                          <th className="py-2.5 pr-3 font-semibold">Atendimento</th>
                          <th className="py-2.5 pr-3 font-semibold">Status</th>
                          <th className="py-2.5 text-right font-semibold">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {appointments.map((appointment) => (
                          <tr key={appointment.appointment_id} className="align-middle hover:bg-gray-50">
                            <td className="whitespace-nowrap py-3 pr-3 font-semibold tabular-nums">
                              {formatTime(appointment.starts_at)} – {formatTime(appointment.ends_at)}
                            </td>
                            <td className="min-w-0 py-3 pr-3 font-medium">
                              <div className="truncate">{appointment.customer_name || appointment.title || 'Sem pessoa'}</div>
                              <div className="mt-0.5 truncate text-xs font-normal text-gray-500">
                                {appointment.customer_phone_e164 ? `WhatsApp: ${appointment.customer_phone_e164}` : 'Sem contato'}
                              </div>
                              {appointment.notes && (
                                <div className="mt-0.5 truncate text-xs font-normal text-gray-500">
                                  {appointment.notes}
                                </div>
                              )}
                            </td>
                            <td className="min-w-0 py-3 pr-3 text-gray-700">
                              <div className="truncate font-medium">{appointment.service_name || 'Sem serviço'}</div>
                              <div className="mt-0.5 truncate text-xs text-gray-500">
                                {appointment.staff_member_name ? `com ${appointment.staff_member_name}` : 'Profissional não definido'}
                              </div>
                            </td>
                            <td className="py-3 pr-2">
                              {renderStatusControl(appointment)}
                            </td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => void deleteAppointment(appointment)}
                                disabled={actingId === appointment.appointment_id}
                                className="h-9 w-full rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-60"
                              >
                                Excluir
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            </section>
          </div>

          <aside className="min-w-0 space-y-4">
            <form onSubmit={saveAppointmentSettings} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <h2 className="font-bold">Funcionamento</h2>

              <fieldset>
                <legend className="text-sm font-medium">Dias de expediente</legend>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {weekdayOptions.map((day) => {
                    const selected = appointmentSettingsForm.working_weekdays.includes(day.value)

                    return (
                      <label
                        key={day.value}
                        className={`flex cursor-pointer items-center justify-center rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                          selected
                            ? 'border-blue-600 bg-blue-50 text-blue-800'
                            : 'border-gray-200 bg-white text-gray-600'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={selected}
                          onChange={(event) => {
                            const nextDays = event.target.checked
                              ? [...appointmentSettingsForm.working_weekdays, day.value]
                              : appointmentSettingsForm.working_weekdays.filter((value) => value !== day.value)

                            setAppointmentSettingsForm({
                              ...appointmentSettingsForm,
                              working_weekdays: Array.from(new Set(nextDays)).sort((left, right) => left - right),
                            })
                          }}
                        />
                        {day.label}
                      </label>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  O Jack só oferecerá horários nos dias selecionados.
                </p>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Abre
                  <input
                    type="time"
                    onClick={openNativePicker}
                    value={appointmentSettingsForm.opens_at}
                    onChange={(event) => setAppointmentSettingsForm({ ...appointmentSettingsForm, opens_at: event.target.value })}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Fecha
                  <input
                    type="time"
                    onClick={openNativePicker}
                    value={appointmentSettingsForm.closes_at}
                    onChange={(event) => setAppointmentSettingsForm({ ...appointmentSettingsForm, closes_at: event.target.value })}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    required
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={appointmentSettingsForm.has_break}
                  onChange={(event) => setAppointmentSettingsForm({ ...appointmentSettingsForm, has_break: event.target.checked })}
                />
                Incluir pausa de almoço/descanso
              </label>

              {appointmentSettingsForm.has_break && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Início da pausa
                    <input
                      type="time"
                      onClick={openNativePicker}
                      value={appointmentSettingsForm.break_starts_at}
                      onChange={(event) => setAppointmentSettingsForm({ ...appointmentSettingsForm, break_starts_at: event.target.value })}
                      className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
                      required
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Duração da pausa
                    <input
                      type="number"
                      min="15"
                      max="240"
                      step="15"
                      value={appointmentSettingsForm.break_duration_minutes}
                      onChange={(event) => setAppointmentSettingsForm({ ...appointmentSettingsForm, break_duration_minutes: event.target.value })}
                      className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal"
                      required
                    />
                  </label>
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg border border-gray-200 py-2 text-sm font-medium disabled:opacity-50"
              >
                Salvar funcionamento
              </button>
            </form>

            <form onSubmit={createAppointmentBlock} className="rounded-2xl bg-white p-5 shadow space-y-3">
              <div>
                <h2 className="font-bold">Fechar agenda temporariamente</h2>
                <p className="mt-1 text-xs text-gray-500">Bloqueie um intervalo contínuo, inclusive entre dias diferentes. Agendamentos existentes permanecem visíveis.</p>
              </div>
              <label className="block text-sm font-medium">
                Indisponível a partir de
                <input type="datetime-local" value={appointmentBlockForm.starts_at} onClick={openNativePicker} onChange={(event) => setAppointmentBlockForm({ ...appointmentBlockForm, starts_at: event.target.value })} className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal" required />
              </label>
              <label className="block text-sm font-medium">
                Volta a ficar disponível em
                <input type="datetime-local" value={appointmentBlockForm.ends_at} onClick={openNativePicker} onChange={(event) => setAppointmentBlockForm({ ...appointmentBlockForm, ends_at: event.target.value })} className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal" required />
              </label>
              <label className="block text-sm font-medium">
                Motivo opcional
                <input value={appointmentBlockForm.reason} onChange={(event) => setAppointmentBlockForm({ ...appointmentBlockForm, reason: event.target.value })} maxLength={240} placeholder="Ex.: viagem, feriado ou manutenção" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 font-normal" />
              </label>
              <button type="submit" disabled={saving} className="w-full rounded-lg bg-gray-950 py-2 text-sm font-medium text-white disabled:opacity-50">Bloquear período</button>

              <div className="border-t border-gray-100 pt-3">
                <h3 className="text-sm font-semibold">Próximos bloqueios</h3>
                {appointmentBlocks.length === 0 ? <p className="mt-2 text-xs text-gray-500">Nenhum período bloqueado.</p> : <div className="mt-2 space-y-2">{appointmentBlocks.map((block) => <div key={block.id} className="rounded-lg border border-gray-200 p-3 text-xs"><p className="font-medium">{new Date(block.starts_at).toLocaleString('pt-BR')} até {new Date(block.ends_at).toLocaleString('pt-BR')}</p>{block.reason ? <p className="mt-1 text-gray-500">{block.reason}</p> : null}<button type="button" onClick={() => void deleteAppointmentBlock(block)} disabled={actingId === block.id} className="mt-2 text-red-700 underline disabled:opacity-50">Liberar período</button></div>)}</div>}
              </div>
            </form>

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
                    onClick={openNativePicker}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
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
                  required
                >
                  <option value="">Selecione um serviço</option>
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
                  required
                  disabled={!appointmentForm.service_id}
                >
                  <option value="">Selecione um profissional</option>
                  {appointmentStaff.map((member) => (
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
                    onClick={openNativePicker}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
                    type="date"
                    required
                  />
                </label>
                <label className="text-sm font-medium">
                  Hora
                  <input
                    value={appointmentForm.time}
                    onChange={(event) => setAppointmentForm({ ...appointmentForm, time: event.target.value })}
                    onClick={openNativePicker}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-gray-200 px-3 py-2 font-normal"
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

            <section className="min-w-0 rounded-2xl bg-white p-4 shadow">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">Serviços</h2>
                <button
                  type="button"
                  onClick={openNewServiceModal}
                  className="rounded-lg bg-gray-950 px-3 py-2 text-xs font-bold text-white"
                >
                  Novo serviço
                </button>
              </div>
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
                          onClick={() => openEditServiceModal(service)}
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
            </section>

            <section className="min-w-0 rounded-2xl bg-white p-5 shadow">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Profissionais</h2>
                  {businessType === 'salon' && (
                    <p className="mt-1 text-xs text-gray-500">
                      A mensalidade inclui 1 profissional. Cada profissional adicional custa R$ 25,00/mês e depende da aprovação da Soft Ink.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openNewStaffModal}
                  className="rounded-lg bg-gray-950 px-3 py-2 text-xs font-bold text-white"
                >
                  Novo profissional
                </button>
              </div>
              {pendingStaffRequests.length > 0 && (
                <div className="mt-3 space-y-2">
                  {pendingStaffRequests.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                    >
                      <div className="font-medium">{request.name}</div>
                      <div className="text-xs">Aguardando aprovação · + R$ 25,00/mês</div>
                    </div>
                  ))}
                </div>
              )}
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
                          onClick={() => openEditStaffModal(member)}
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
            </section>
          </aside>
        </section>

        {isServiceModalOpen && (
          <div
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6"
            role="dialog"
          >
            <form
              onSubmit={saveService}
              className="w-full max-w-xl space-y-3 rounded-2xl bg-white p-5 shadow-xl"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">
                  {editingServiceId ? 'Editar serviço' : 'Novo serviço'}
                </h2>
                <button
                  type="button"
                  onClick={closeServiceModal}
                  className="text-sm font-medium text-gray-500"
                >
                  Fechar
                </button>
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
                  placeholder="Tempo obrigatorio em minutos"
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
              <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
                <legend className="px-1 text-sm font-medium">
                  Profissionais que executam este serviço
                </legend>
                {staff.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    Cadastre um profissional antes de criar serviços.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {staff.map((member) => (
                      <label className="flex items-center gap-2 text-sm" key={member.id}>
                        <input
                          checked={serviceForm.staff_member_ids.includes(member.id)}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...serviceForm.staff_member_ids, member.id]
                              : serviceForm.staff_member_ids.filter((id) => id !== member.id)

                            setServiceForm({
                              ...serviceForm,
                              staff_member_ids: nextIds,
                            })
                          }}
                          type="checkbox"
                        />
                        <span>{member.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={closeServiceModal}
                  className="rounded-lg border border-gray-200 py-2 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-950 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : editingServiceId ? 'Salvar serviço' : 'Criar serviço'}
                </button>
              </div>
            </form>
          </div>
        )}

        {isStaffModalOpen && (
          <div
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6"
            role="dialog"
          >
            <form
              onSubmit={saveStaff}
              className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-xl"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold">
                  {editingStaffId ? 'Editar profissional' : 'Novo profissional'}
                </h2>
                <button
                  type="button"
                  onClick={closeStaffModal}
                  className="text-sm font-medium text-gray-500"
                >
                  Fechar
                </button>
              </div>

              {!editingStaffId && businessType === 'salon' && staff.length >= 1 && (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  Este profissional será enviado para aprovação da Soft Ink. Depois de aprovado, ficará disponível na agenda e acrescentará R$ 25,00 por mês à mensalidade.
                </div>
              )}

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
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={closeStaffModal}
                  className="rounded-lg border border-gray-200 py-2 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-gray-950 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : editingStaffId ? 'Salvar profissional' : 'Criar profissional'}
                </button>
              </div>
            </form>
          </div>
        )}

        {isOutcomeQueueOpen && (
          <div
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-6"
            role="dialog"
          >
            <section className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">O serviço aconteceu?</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Confirme os atendimentos cujo horário já terminou. Somente serviços concluídos entram no financeiro.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOutcomeQueueOpen(false)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium"
                >
                  Fechar
                </button>
              </div>

              {outcomeQueue.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">
                  Nenhum atendimento aguardando confirmação.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {outcomeQueue.map((appointment) => (
                    <article
                      key={appointment.appointment_id}
                      className="grid gap-4 rounded-xl border border-gray-200 p-4 md:grid-cols-[1fr_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="font-bold">
                          {appointment.customer_name || appointment.title || 'Cliente sem nome'}
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          {appointment.service_name || 'Serviço não informado'}
                          {appointment.staff_member_name ? ` · ${appointment.staff_member_name}` : ''}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {new Date(appointment.starts_at).toLocaleString('pt-BR')} até {formatTime(appointment.ends_at)}
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => void updateStatus(appointment, 'completed')}
                          disabled={actingId === appointment.appointment_id}
                          className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Serviço realizado
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateStatus(appointment, 'no_show')}
                          disabled={actingId === appointment.appointment_id}
                          className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-bold text-amber-800 disabled:opacity-50"
                        >
                          Cliente faltou
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateStatus(appointment, 'cancelled')}
                          disabled={actingId === appointment.appointment_id}
                          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                        >
                          Foi cancelado
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
