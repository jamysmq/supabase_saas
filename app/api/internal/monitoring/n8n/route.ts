import { inspectN8nWorkflows, type OperationalIssue } from '../../../../../src/lib/n8n-monitoring'
import { createSupabaseAdminClient } from '../../../../../src/lib/platform-admin'
import {
  createWhatsAppCloudClient,
  getWhatsAppCloudConfigFromEnv,
} from '../../../../../src/lib/whatsapp-cloud'

type StoredIncident = {
  id: string
  incident_key: string
  title: string
  status: 'active' | 'resolved'
  notified_at: string | null
  resolution_notified_at: string | null
  notification_attempts: number
}

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  const whatsappToken = process.env.WHATSAPP_INTERNAL_SEND_TOKEN?.trim()
  const authorization = request.headers.get('authorization')
  return Boolean(
    (cronSecret && authorization === `Bearer ${cronSecret}`) ||
    (whatsappToken && authorization === `Bearer ${whatsappToken}`)
  )
}

function alertsEnabled() {
  return process.env.PLATFORM_OPERATIONAL_ALERTS_ENABLED?.trim().toLowerCase() === 'true'
}

function alertConfig() {
  const to = process.env.PLATFORM_ALERT_WHATSAPP_E164?.replace(/\D/g, '')
  const templateName = process.env.PLATFORM_OPERATIONAL_ALERT_TEMPLATE_NAME?.trim()
  if (!to || !templateName) return null
  return { to, templateName }
}

function issueRow(issue: OperationalIssue, now: string) {
  return {
    source: 'n8n',
    incident_key: issue.id,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    workflow_id: issue.workflowId ?? null,
    workflow_name: issue.workflowName ?? null,
    execution_id: issue.executionId ?? null,
    status: 'active',
    last_detected_at: now,
    resolved_at: null,
    updated_at: now,
  }
}

async function sendOperationalUpdate(message: string) {
  const config = alertConfig()
  if (!alertsEnabled() || !config) return null

  const client = createWhatsAppCloudClient(getWhatsAppCloudConfigFromEnv())
  const response = await client.sendTemplate({
    to: config.to,
    name: config.templateName,
    languageCode: 'pt_BR',
    bodyParameters: [message.slice(0, 900)],
  })

  return response.messages?.[0]?.id ?? null
}

async function recordNotificationFailure(
  incidentIds: string[],
  incidents: StoredIncident[],
  error: unknown
) {
  if (incidentIds.length === 0) return
  const supabase = createSupabaseAdminClient()
  const attemptsById = new Map(incidents.map((incident) => [incident.id, incident.notification_attempts]))
  const message = error instanceof Error ? error.message : String(error)

  await Promise.all(incidentIds.map((id) =>
    supabase
      .from('platform_operational_incidents')
      .update({
        notification_attempts: (attemptsById.get(id) ?? 0) + 1,
        last_notification_error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  ))
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()
  const checkedAt = new Date().toISOString()
  const monitoring = await inspectN8nWorkflows()

  const { data: activeData, error: activeError } = await supabase
    .from('platform_operational_incidents')
    .select('id, incident_key, title, status, notified_at, resolution_notified_at, notification_attempts')
    .eq('source', 'n8n')
    .eq('status', 'active')

  if (activeError) {
    return Response.json({ error: 'Could not load active incidents.' }, { status: 500 })
  }

  const activeIncidents = (activeData ?? []) as StoredIncident[]
  const activeByKey = new Map(activeIncidents.map((incident) => [incident.incident_key, incident]))
  const currentKeys = new Set(monitoring.issues.map((issue) => issue.id))

  for (const issue of monitoring.issues) {
    const existing = activeByKey.get(issue.id)
    if (existing) {
      const { error } = await supabase
        .from('platform_operational_incidents')
        .update(issueRow(issue, checkedAt))
        .eq('id', existing.id)
      if (error) return Response.json({ error: 'Could not update incident.' }, { status: 500 })
      continue
    }

    const { error } = await supabase
      .from('platform_operational_incidents')
      .upsert({
        ...issueRow(issue, checkedAt),
        first_detected_at: issue.detectedAt || checkedAt,
        notified_at: null,
        resolution_notified_at: null,
        notification_attempts: 0,
        provider_message_id: null,
        last_notification_error: null,
        created_at: checkedAt,
      }, { onConflict: 'incident_key' })
    if (error) return Response.json({ error: 'Could not create incident.' }, { status: 500 })
  }

  const resolved = activeIncidents.filter((incident) => !currentKeys.has(incident.incident_key))
  if (resolved.length > 0) {
    const { error } = await supabase
      .from('platform_operational_incidents')
      .update({ status: 'resolved', resolved_at: checkedAt, updated_at: checkedAt })
      .in('id', resolved.map((incident) => incident.id))
    if (error) return Response.json({ error: 'Could not resolve incidents.' }, { status: 500 })
  }

  const { data: refreshedData, error: refreshedError } = await supabase
    .from('platform_operational_incidents')
    .select('id, incident_key, title, status, notified_at, resolution_notified_at, notification_attempts')
    .eq('source', 'n8n')
    .order('last_detected_at', { ascending: false })
    .limit(100)

  if (refreshedError) {
    return Response.json({ error: 'Could not refresh incidents.' }, { status: 500 })
  }

  const refreshed = (refreshedData ?? []) as StoredIncident[]
  const newAlerts = refreshed.filter((incident) => incident.status === 'active' && !incident.notified_at)
  const recoveries = refreshed.filter((incident) =>
    incident.status === 'resolved' && incident.notified_at && !incident.resolution_notified_at
  )
  let alertSent = false
  let recoverySent = false

  if (newAlerts.length > 0 && alertsEnabled()) {
    try {
      const summary = newAlerts.map((incident) => `\u2022 ${incident.title}`).join('\n')
      const providerMessageId = await sendOperationalUpdate(`\u26a0\ufe0f Aten\u00e7\u00e3o necess\u00e1ria:\n${summary}`)
      if (providerMessageId) {
        const { error } = await supabase
          .from('platform_operational_incidents')
          .update({
            notified_at: checkedAt,
            provider_message_id: providerMessageId,
            last_notification_error: null,
            updated_at: checkedAt,
          })
          .in('id', newAlerts.map((incident) => incident.id))
        if (error) throw error
        alertSent = true
      }
    } catch (error) {
      await recordNotificationFailure(newAlerts.map((incident) => incident.id), refreshed, error)
    }
  }

  if (recoveries.length > 0 && alertsEnabled()) {
    try {
      const summary = recoveries.map((incident) => `\u2022 ${incident.title}`).join('\n')
      const providerMessageId = await sendOperationalUpdate(`\u2705 Situa\u00e7\u00e3o normalizada:\n${summary}`)
      if (providerMessageId) {
        const { error } = await supabase
          .from('platform_operational_incidents')
          .update({ resolution_notified_at: checkedAt, updated_at: checkedAt })
          .in('id', recoveries.map((incident) => incident.id))
        if (error) throw error
        recoverySent = true
      }
    } catch (error) {
      await recordNotificationFailure(recoveries.map((incident) => incident.id), refreshed, error)
    }
  }

  return Response.json({
    ok: true,
    checkedAt,
    alertsEnabled: alertsEnabled(),
    activeIncidents: monitoring.issues.length,
    resolvedIncidents: resolved.length,
    alertSent,
    recoverySent,
  })
}
