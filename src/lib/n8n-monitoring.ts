import 'server-only'

export type OperationalIssue = {
  id: string
  severity: 'critical' | 'warning'
  title: string
  description: string
  workflowId?: string
  workflowName?: string
  executionId?: string | null
  detectedAt: string
}

type MonitoredWorkflow = {
  id: string
  name: string
  maxSilenceMinutes: number | null
}

type N8nWorkflowResponse = {
  id: string
  name: string
  active: boolean
}

type N8nExecution = {
  id: string
  status: string
  startedAt: string
  stoppedAt?: string | null
}

type N8nExecutionsResponse = {
  data?: N8nExecution[]
}

const monitoredWorkflows: MonitoredWorkflow[] = [
  { id: 'JSlq95lyTAVjZjtz', name: 'Roteador do WhatsApp', maxSilenceMinutes: null },
  { id: 'X1lUop6Q5fh9uxTG', name: 'Agendamentos pelo WhatsApp', maxSilenceMinutes: null },
  { id: 'zWflZZXKn2XIlHEc', name: 'Notificações de agendamento', maxSilenceMinutes: 45 },
  { id: 'dcKARQX6GDCBPo3W', name: 'Resumo diário da agenda', maxSilenceMinutes: 45 },
  { id: 'A4XOl16nkcIYOre1', name: 'Cadastros e cobranças pelo WhatsApp', maxSilenceMinutes: null },
  { id: 'YbD6NHWbgz9vLe33w_UU-', name: 'Lembretes de cobrança', maxSilenceMinutes: 36 * 60 },
]

function n8nConfig() {
  const baseUrl = process.env.N8N_BASE_URL?.trim().replace(/\/$/, '')
  const apiKey = process.env.N8N_API_KEY?.trim()

  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey }
}

async function n8nGet<T>(path: string, config: { baseUrl: string; apiKey: string }) {
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: { 'X-N8N-API-KEY': config.apiKey },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  })

  if (!response.ok) {
    throw new Error(`n8n_http_${response.status}`)
  }

  return (await response.json()) as T
}

function executionIssue(
  workflow: MonitoredWorkflow,
  execution: N8nExecution,
  now: Date
): OperationalIssue | null {
  if (!['error', 'crashed'].includes(execution.status)) return null

  return {
    id: `n8n-execution-${workflow.id}`,
    severity: 'critical',
    title: `${workflow.name} falhou`,
    description: `A execução ${execution.id} terminou com status ${execution.status}.`,
    workflowId: workflow.id,
    workflowName: workflow.name,
    executionId: execution.id,
    detectedAt: execution.stoppedAt || execution.startedAt || now.toISOString(),
  }
}

export async function inspectN8nWorkflows() {
  const checkedAt = new Date()
  const config = n8nConfig()

  if (!config) {
    return {
      configured: false,
      checkedAt: checkedAt.toISOString(),
      healthyWorkflows: 0,
      totalWorkflows: monitoredWorkflows.length,
      issues: [
        {
          id: 'n8n-monitor-not-configured',
          severity: 'critical' as const,
          title: 'Monitoramento do n8n não configurado',
          description: 'N8N_BASE_URL ou N8N_API_KEY não está disponível no ambiente do app.',
          detectedAt: checkedAt.toISOString(),
        },
      ],
    }
  }

  const inspections = await Promise.allSettled(
    monitoredWorkflows.map(async (workflow) => {
      const [remoteWorkflow, executions] = await Promise.all([
        n8nGet<N8nWorkflowResponse>(`/api/v1/workflows/${workflow.id}`, config),
        n8nGet<N8nExecutionsResponse>(
          `/api/v1/executions?workflowId=${encodeURIComponent(workflow.id)}&limit=1`,
          config
        ),
      ])

      return { workflow, remoteWorkflow, latestExecution: executions.data?.[0] ?? null }
    })
  )

  const issues: OperationalIssue[] = []
  let healthyWorkflows = 0

  inspections.forEach((inspection, index) => {
    const configuredWorkflow = monitoredWorkflows[index]

    if (inspection.status === 'rejected') {
      issues.push({
        id: `n8n-unavailable-${configuredWorkflow.id}`,
        severity: 'critical',
        title: `Não foi possível consultar ${configuredWorkflow.name}`,
        description: 'A API do n8n não respondeu corretamente ao monitoramento.',
        workflowId: configuredWorkflow.id,
        workflowName: configuredWorkflow.name,
        detectedAt: checkedAt.toISOString(),
      })
      return
    }

    const { workflow, remoteWorkflow, latestExecution } = inspection.value
    let workflowHealthy = true

    if (!remoteWorkflow.active) {
      workflowHealthy = false
      issues.push({
        id: `n8n-inactive-${workflow.id}`,
        severity: 'critical',
        title: `${workflow.name} está desativado`,
        description: 'O workflow crítico precisa ser revisado antes de voltar a processar mensagens.',
        workflowId: workflow.id,
        workflowName: workflow.name,
        detectedAt: checkedAt.toISOString(),
      })
    }

    if (latestExecution) {
      const failure = executionIssue(workflow, latestExecution, checkedAt)
      if (failure) {
        workflowHealthy = false
        issues.push(failure)
      }
    }

    if (workflow.maxSilenceMinutes !== null) {
      const lastStartedAt = latestExecution?.startedAt
        ? new Date(latestExecution.startedAt).getTime()
        : Number.NaN
      const silenceMinutes = Number.isFinite(lastStartedAt)
        ? (checkedAt.getTime() - lastStartedAt) / 60_000
        : Number.POSITIVE_INFINITY

      if (silenceMinutes > workflow.maxSilenceMinutes) {
        workflowHealthy = false
        issues.push({
          id: `n8n-stale-${workflow.id}`,
          severity: 'warning',
          title: `${workflow.name} está sem executar`,
          description: latestExecution
            ? `A última execução começou em ${latestExecution.startedAt}.`
            : 'Nenhuma execução recente foi encontrada.',
          workflowId: workflow.id,
          workflowName: workflow.name,
          executionId: latestExecution?.id ?? null,
          detectedAt: checkedAt.toISOString(),
        })
      }
    }

    if (workflowHealthy) healthyWorkflows += 1
  })

  return {
    configured: true,
    checkedAt: checkedAt.toISOString(),
    healthyWorkflows,
    totalWorkflows: monitoredWorkflows.length,
    issues,
  }
}
