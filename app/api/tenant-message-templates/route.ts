import {
  requireTenantUser,
  tenantCanUseAppointments,
  tenantCanUseBilling,
  tenantCanUseRestaurant,
} from '../../../src/lib/tenant-admin'

type TemplateKey =
  | 'billing_reminder_due_today'
  | 'appointment_welcome'
  | 'appointment_confirmation_reminder'
  | 'restaurant_welcome'

type TemplateDefinition = {
  key: TemplateKey
  title: string
  description: string
  defaultContent: string
  capability: 'billing' | 'appointments' | 'restaurant'
}

const templateDefinitions: TemplateDefinition[] = [
  {
    key: 'billing_reminder_due_today',
    title: 'Cobranca mensal',
    description: 'Mensagem usada para avisar clientes sobre mensalidades pendentes.',
    capability: 'billing',
    defaultContent:
      'Ola, {{customer_name}}! Sua mensalidade de {{amount}} vence em {{due_date}}. Pix: {{pix_key}}.',
  },
  {
    key: 'appointment_welcome',
    title: 'Boas-vindas da agenda',
    description: 'Mensagem inicial para clientes que vao marcar horarios pelo WhatsApp.',
    capability: 'appointments',
    defaultContent:
      'Ola! Eu sou o assistente de agendamento de {{tenant_name}}. Me diga o servico e o melhor dia para voce.',
  },
  {
    key: 'appointment_confirmation_reminder',
    title: 'Confirmacao de agendamento',
    description: 'Mensagem enviada um dia antes do agendamento para confirmar, remarcar ou cancelar.',
    capability: 'appointments',
    defaultContent:
      'Ola, {{customer_name}}! Confirmando seu horario em {{appointment_date}} as {{appointment_time}} com {{tenant_name}}. Responda 1 para confirmar, 2 para remarcar ou 3 para cancelar.',
  },
  {
    key: 'restaurant_welcome',
    title: 'Mensagem inicial do restaurante',
    description: 'Mensagem futura para iniciar pedidos e consulta de cardapio pelo WhatsApp.',
    capability: 'restaurant',
    defaultContent:
      'Ola! Bem-vindo ao {{tenant_name}}. Me diga se voce quer ver o cardapio ou fazer um pedido.',
  },
]

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function tenantCanUseTemplate(
  tenant: { plan?: string | null },
  definition: TemplateDefinition
) {
  if (definition.capability === 'billing') return tenantCanUseBilling(tenant)
  if (definition.capability === 'appointments') return tenantCanUseAppointments(tenant)
  return tenantCanUseRestaurant(tenant)
}

function availableDefinitions(tenant: { plan?: string | null }) {
  return templateDefinitions.filter((definition) =>
    tenantCanUseTemplate(tenant, definition)
  )
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
    return errorResponse('Nao foi possivel carregar as mensagens.', 500, error.message)
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
      return errorResponse('Mensagem nao permitida para o plano atual.', 403)
    }

    const content = String(template?.content ?? '').trim()

    if (!content) {
      return errorResponse(`Informe o texto da mensagem "${definition.title}".`)
    }

    if (content.length > 2000) {
      return errorResponse(`A mensagem "${definition.title}" deve ter no maximo 2000 caracteres.`)
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
      return errorResponse('Nao foi possivel validar a mensagem existente.', 500, existingError.message)
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
      return errorResponse('Nao foi possivel salvar a mensagem.', 500, error?.message)
    }

    savedTemplates.push(data)
  }

  return Response.json({ templates: savedTemplates })
}
