import {
  requireTenantUser,
  tenantCanUseBilling,
} from '../../../src/lib/tenant-admin'

type TemplateKey = 'billing_reminder_due_today'

type TemplateDefinition = {
  key: TemplateKey
  title: string
  description: string
  defaultContent: string
}

const templateDefinitions: TemplateDefinition[] = [
  {
    key: 'billing_reminder_due_today',
    title: 'Cobrança mensal',
    description: 'Mensagem usada para avisar clientes sobre mensalidades pendentes.',
    defaultContent:
      'Olá, {{customer_name}}! Aqui é o Assistente Jack, de {{tenant_name}}. Sua mensalidade de {{amount}} vence em {{due_date}}. Pix: {{pix_key}}.',
  },
]

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function availableDefinitions(tenant: { plan?: string | null }) {
  return tenantCanUseBilling(tenant) ? templateDefinitions : []
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const definitions = availableDefinitions(result.tenant)
  const keys = definitions.map((definition) => definition.key)

  if (keys.length === 0) {
    return Response.json({ templates: [] })
  }

  const { data, error } = await result.supabase
    .from('tenant_message_templates')
    .select('id, template_key, channel, content, is_active, updated_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .in('template_key', keys)

  if (error) {
    return errorResponse('Não foi possível carregar as mensagens.', 500, error.message)
  }

  const rowsByKey = new Map((data ?? []).map((row) => [row.template_key, row]))

  return Response.json({
    templates: definitions.map((definition) => {
      const row = rowsByKey.get(definition.key)

      return {
        id: row?.id ?? null,
        template_key: definition.key,
        title: definition.title,
        description: definition.description,
        channel: row?.channel ?? 'whatsapp',
        content: row?.content ?? definition.defaultContent,
        is_active: row?.is_active ?? true,
        updated_at: row?.updated_at ?? null,
      }
    }),
  })
}

export async function PUT(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  const allowedDefinitions = availableDefinitions(result.tenant)
  const allowedByKey = new Map(
    allowedDefinitions.map((definition) => [definition.key, definition])
  )
  const body = await request.json().catch(() => null)
  const templates = Array.isArray(body?.templates) ? body.templates : []

  if (templates.length === 0) {
    return errorResponse('Informe ao menos uma mensagem para salvar.')
  }

  const savedTemplates = []

  for (const template of templates) {
    const key = String(template?.template_key ?? '').trim() as TemplateKey
    const definition = allowedByKey.get(key)

    if (!definition) {
      return errorResponse('Mensagem não permitida para o plano atual.', 403)
    }

    const content = String(template?.content ?? '').trim()

    if (!content) {
      return errorResponse(`Informe o texto da mensagem "${definition.title}".`)
    }

    if (content.length > 2000) {
      return errorResponse(`A mensagem "${definition.title}" deve ter no máximo 2000 caracteres.`)
    }

    const basePayload = {
      tenant_id: result.tenantUser.tenant_id,
      template_key: key,
      channel: 'whatsapp',
      content,
      is_active: Boolean(template?.is_active ?? true),
      updated_at: new Date().toISOString(),
    }

    const { data: existing, error: existingError } = await result.supabase
      .from('tenant_message_templates')
      .select('id')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('template_key', key)
      .maybeSingle()

    if (existingError) {
      return errorResponse('Não foi possível validar a mensagem existente.', 500, existingError.message)
    }

    const query = existing
      ? result.supabase
          .from('tenant_message_templates')
          .update(basePayload)
          .eq('id', existing.id)
          .select('id, template_key, channel, content, is_active, updated_at')
          .single()
      : result.supabase
          .from('tenant_message_templates')
          .insert({
            ...basePayload,
            created_at: new Date().toISOString(),
          })
          .select('id, template_key, channel, content, is_active, updated_at')
          .single()

    const { data, error } = await query

    if (error || !data) {
      return errorResponse('Não foi possível salvar a mensagem.', 500, error?.message)
    }

    savedTemplates.push(data)
  }

  return Response.json({ templates: savedTemplates })
}
