import { inspectN8nWorkflows, type OperationalIssue } from '../../../../../src/lib/n8n-monitoring'
import { createSupabaseAdminClient } from '../../../../../src/lib/platform-admin'

type StoredIncident = {
  id: string
  incident_key: string
}

function isAuthorized(request: Request) {
  const whatsappToken = process.env.WHATSAPP_INTERNAL_SEND_TOKEN?.trim()
  const authorization = request.headers.get('authorization')
  return Boolean(whatsappToken && authorization === `Bearer ${whatsappToken}`)
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

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseAdminClient()
  const checkedAt = new Date().toISOString()
  const monitoring = await inspectN8nWorkflows()

  const { data: activeData, error: activeError } = await supabase
    .from('platform_operational_incidents')
    .select('id, incident_key')
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

  return Response.json({
    ok: true,
    checkedAt,
    activeIncidents: monitoring.issues.length,
    resolvedIncidents: resolved.length,
  })
}
