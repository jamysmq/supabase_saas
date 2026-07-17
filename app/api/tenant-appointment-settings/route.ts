import { requireTenantUser, tenantCanUseAppointments } from '../../../src/lib/tenant-admin'

const DEFAULT_SETTINGS = {
  opens_at: '08:00',
  closes_at: '18:00',
  working_weekdays: [1, 2, 3, 4, 5],
  has_break: false,
  break_starts_at: '12:00',
  break_duration_minutes: 60,
  timezone: 'America/Fortaleza',
}

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function normalizeTime(value: unknown) {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/)

  if (!match) return null

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function normalizeSettings(body: Record<string, unknown> | null) {
  const opensAt = normalizeTime(body?.opens_at)
  const closesAt = normalizeTime(body?.closes_at)
  const workingWeekdays = Array.from(new Set(
    (Array.isArray(body?.working_weekdays) ? body.working_weekdays : [])
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  )).sort((left, right) => left - right)
  const hasBreak = Boolean(body?.has_break)
  const breakStartsAt = normalizeTime(body?.break_starts_at)
  const breakDurationMinutes = Number(body?.break_duration_minutes)
  const timezone = String(body?.timezone ?? DEFAULT_SETTINGS.timezone).trim() || DEFAULT_SETTINGS.timezone

  if (!opensAt || !closesAt) {
    return { error: 'Informe os horarios de abertura e fechamento.' }
  }

  if (workingWeekdays.length === 0) {
    return { error: 'Selecione pelo menos um dia da semana para o expediente.' }
  }

  if (timeToMinutes(closesAt) <= timeToMinutes(opensAt)) {
    return { error: 'O horario de fechamento precisa ser depois da abertura.' }
  }

  if (timezone.length > 80) {
    return { error: 'Timezone invalido.' }
  }

  if (!hasBreak) {
    return {
      settings: {
        opens_at: opensAt,
        closes_at: closesAt,
        working_weekdays: workingWeekdays,
        has_break: false,
        break_starts_at: null,
        break_duration_minutes: null,
        timezone,
      },
    }
  }

  if (!breakStartsAt || !Number.isInteger(breakDurationMinutes) || breakDurationMinutes < 15 || breakDurationMinutes > 240) {
    return { error: 'Informe a pausa com inicio e duracao entre 15 e 240 minutos.' }
  }

  const breakStartMinutes = timeToMinutes(breakStartsAt)
  const breakEndMinutes = breakStartMinutes + breakDurationMinutes

  if (breakStartMinutes <= timeToMinutes(opensAt) || breakEndMinutes >= timeToMinutes(closesAt)) {
    return { error: 'A pausa precisa ficar dentro do horario de funcionamento.' }
  }

  return {
    settings: {
      opens_at: opensAt,
      closes_at: closesAt,
      working_weekdays: workingWeekdays,
      has_break: true,
      break_starts_at: breakStartsAt,
      break_duration_minutes: breakDurationMinutes,
      timezone,
    },
  }
}

function serializeSettings(settings: typeof DEFAULT_SETTINGS | null) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings ?? {}),
    opens_at: String(settings?.opens_at ?? DEFAULT_SETTINGS.opens_at).slice(0, 5),
    closes_at: String(settings?.closes_at ?? DEFAULT_SETTINGS.closes_at).slice(0, 5),
    break_starts_at: settings?.break_starts_at ? String(settings.break_starts_at).slice(0, 5) : DEFAULT_SETTINGS.break_starts_at,
    break_duration_minutes: settings?.break_duration_minutes ?? DEFAULT_SETTINGS.break_duration_minutes,
    has_break: Boolean(settings?.has_break),
    working_weekdays: Array.isArray(settings?.working_weekdays)
      ? settings.working_weekdays.map(Number)
      : DEFAULT_SETTINGS.working_weekdays,
  }
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const { data, error } = await result.supabase
    .from('tenant_appointment_settings')
    .select('opens_at, closes_at, working_weekdays, has_break, break_starts_at, break_duration_minutes, timezone')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (error) {
    return errorResponse('Nao foi possivel carregar os horarios da agenda.', 500, error.message)
  }

  return Response.json({ settings: serializeSettings(data) })
}

export async function PUT(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseAppointments(result.tenant)) {
    return errorResponse('Agenda disponivel apenas em planos com agenda.', 403)
  }

  const body = await request.json().catch(() => null)
  const normalized = normalizeSettings(body)

  if ('error' in normalized) {
    return errorResponse(normalized.error ?? 'Dados invalidos.')
  }

  const { data, error } = await result.supabase
    .from('tenant_appointment_settings')
    .upsert({
      tenant_id: result.tenantUser.tenant_id,
      ...normalized.settings,
      updated_at: new Date().toISOString(),
    })
    .select('opens_at, closes_at, working_weekdays, has_break, break_starts_at, break_duration_minutes, timezone')
    .single()

  if (error || !data) {
    return errorResponse('Nao foi possivel salvar os horarios da agenda.', 500, error?.message)
  }

  return Response.json({ settings: serializeSettings(data) })
}
