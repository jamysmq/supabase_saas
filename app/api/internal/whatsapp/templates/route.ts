type MetaErrorBody = {
  error?: {
    code?: number
    message?: string
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    error_data?: { details?: string }
  }
}

const templateDefinitions = [
  {
    name: 'jack_appointment_reminder_h1',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: true,
    components: [{
      type: 'BODY',
      text: 'Olá, {{1}}! Este é um lembrete automático do Assistente Jack: seu atendimento em {{2}} está marcado para hoje, às {{3}}. O serviço agendado é {{4}}. Se precisar de ajuda, entre em contato com a equipe do estabelecimento. Até breve!',
      example: {
        body_text: [['Sidney Magal', 'Salão Teste', '21:30', 'Corte + barba']],
      },
    }],
  },
  {
    name: 'jack_appointment_confirmation_d1',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: true,
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Esta é a confirmação automática do Assistente Jack para seu atendimento em {{2}}. A data agendada é {{3}}, com início às {{4}}, para o serviço {{5}}. Escolha abaixo se deseja confirmar, remarcar ou cancelar. Se precisar de ajuda, fale com a equipe do estabelecimento.',
        example: {
          body_text: [['Sidney Magal', 'Salão Teste', '17/07/2026', '21:30', 'Corte + barba']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar' },
          { type: 'QUICK_REPLY', text: 'Remarcar' },
          { type: 'QUICK_REPLY', text: 'Cancelar' },
        ],
      },
    ],
  },
  {
    name: 'jack_billing_due_reminder_v2',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: true,
    components: [{
      type: 'BODY',
      text: 'Olá, {{1}}! 😊\n\nPassando para lembrar que sua mensalidade com {{2}}, no valor de {{3}}, vence em {{4}}.\n\n💳 Chave Pix: {{5}}\n\nSe você já realizou o pagamento, pode desconsiderar esta mensagem.\n\nEm caso de dúvida, fale com a equipe de {{2}}. Estamos à disposição!',
      example: {
        body_text: [['Maria Silva', 'Professor Exemplo', 'R$ 240,00', '17/07/2026', 'email@pix.com']],
      },
    }],
  },
  {
    name: 'jack_billing_overdue_reminder_v1',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: true,
    components: [{
      type: 'BODY',
      text: 'Olá, {{1}}! 😊\n\nPassando para lembrar que sua mensalidade com {{2}}, no valor de {{3}}, venceu em {{4}} e está pendente.\n\nChave Pix: {{5}}\n\nSe você já realizou o pagamento, pode desconsiderar esta mensagem.\n\nEm caso de dúvida, fale com a equipe de {{2}}. Estamos à disposição!',
      example: {
        body_text: [['Maria da Silva', 'Professor Teste', 'R$ 49,90', '10/07/2026', '11999999999']],
      },
    }],
  },
  {
    name: 'jack_daily_agenda_summary',
    language: 'pt_BR',
    category: 'UTILITY',
    allow_category_change: true,
    components: [{
      type: 'BODY',
      text: 'Olá! Este é o resumo automático da agenda de {{1}} para hoje, {{2}}. Confira abaixo os horários e clientes previstos:\n\n{{3}}\n\nTotal de atendimentos: {{4}}. Para consultar ou alterar os detalhes, acesse o painel do Assistente Jack.',
      example: {
        body_text: [['Salão Exemplo', '17/07/2026', '1) 09:00 - Maria - Corte\n2) 10:30 - João - Barba', '2']],
      },
    }],
  },
]

function isAuthorized(request: Request) {
  const expected = process.env.WHATSAPP_TEMPLATE_ADMIN_TOKEN?.trim()
  const received = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return Boolean(expected && received === expected)
}

async function metaRequest(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => ({})) as MetaErrorBody & Record<string, unknown>

  if (!response.ok) {
    throw new Error(JSON.stringify({
      status: response.status,
      code: body.error?.code ?? null,
      subcode: body.error?.error_subcode ?? null,
      message: body.error?.message ?? 'Meta API request failed.',
      title: body.error?.error_user_title ?? null,
      userMessage: body.error?.error_user_msg ?? null,
      details: body.error?.error_data?.details ?? null,
    }))
  }

  return body
}

async function resolveWabaId(graphVersion: string, phoneNumberId: string, accessToken: string) {
  const baseUrl = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}`
  const accounts: Array<{ id?: string; phone_numbers?: { data?: Array<{ id?: string }> } }> = []
  const candidateAccountIds = new Set<string>()
  const businessesToInspect = new Set<string>()

  try {
    const debug = await metaRequest(
      `${baseUrl}/debug_token?input_token=${encodeURIComponent(accessToken)}`,
      accessToken
    )
    const debugData = debug.data as {
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>
    } | undefined
    for (const permission of debugData?.granular_scopes ?? []) {
      if (!permission.scope?.startsWith('whatsapp_business_')) continue
      for (const targetId of permission.target_ids ?? []) candidateAccountIds.add(targetId)
    }
  } catch {
    // Some production tokens cannot introspect themselves.
  }

  let meId = ''
  try {
    const me = await metaRequest(`${baseUrl}/me?fields=id`, accessToken)
    meId = typeof me.id === 'string' ? me.id : ''
  } catch {
    // Continue with token target IDs and business edges.
  }

  if (meId) {
    try {
      const assigned = await metaRequest(
        `${baseUrl}/${encodeURIComponent(meId)}/assigned_whatsapp_business_accounts?fields=id,phone_numbers{id}`,
        accessToken
      )
      if (Array.isArray(assigned.data)) accounts.push(...assigned.data as typeof accounts)
    } catch {
      // A user token may expose businesses instead of assigned system-user assets.
    }
  }

  for (const candidateId of candidateAccountIds) {
    try {
      const phoneNumbers = await metaRequest(
        `${baseUrl}/${encodeURIComponent(candidateId)}/phone_numbers?fields=id`,
        accessToken
      )
      const rows = Array.isArray(phoneNumbers.data)
        ? phoneNumbers.data as Array<{ id?: string }>
        : []
      accounts.push({ id: candidateId, phone_numbers: { data: rows } })
    } catch {
      // The target may be a business or app rather than a WhatsApp account.
      businessesToInspect.add(candidateId)
    }
  }

  try {
    const businesses = await metaRequest(`${baseUrl}/me/businesses?fields=id`, accessToken)
    const businessRows = Array.isArray(businesses.data) ? businesses.data as Array<{ id?: string }> : []
    for (const business of businessRows) {
      if (business.id) businessesToInspect.add(business.id)
    }
  } catch {
    // System-user tokens commonly resolve through assigned assets above.
  }

  for (const businessId of businessesToInspect) {
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      try {
        const response = await metaRequest(
          `${baseUrl}/${encodeURIComponent(businessId)}/${edge}?fields=id,phone_numbers{id}`,
          accessToken
        )
        if (Array.isArray(response.data)) accounts.push(...response.data as typeof accounts)
      } catch {
        // Not every business exposes both ownership edges to the current token.
      }
    }
  }

  const matchingAccount = accounts.find((account) =>
    account.phone_numbers?.data?.some((phone) => phone.id === phoneNumberId)
  )
  if (matchingAccount?.id) return matchingAccount.id

  const uniqueAccountIds = [...new Set(accounts.map((account) => account.id).filter(Boolean))]
  return uniqueAccountIds.length === 1 ? uniqueAccountIds[0] : null
}

async function diagnoseWabaResolution(graphVersion: string, phoneNumberId: string, accessToken: string) {
  const baseUrl = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}`
  const diagnostics: Record<string, unknown> = {}

  try {
    const phone = await metaRequest(
      `${baseUrl}/${encodeURIComponent(phoneNumberId)}?fields=whatsapp_business_account`,
      accessToken
    )
    diagnostics.phone_waba_id = (phone.whatsapp_business_account as { id?: unknown } | undefined)?.id ?? null
  } catch (error) {
    diagnostics.phone_lookup_error = error instanceof Error ? error.message : String(error)
  }

  try {
    const debug = await metaRequest(
      `${baseUrl}/debug_token?input_token=${encodeURIComponent(accessToken)}`,
      accessToken
    )
    const data = debug.data as {
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>
      scopes?: string[]
    } | undefined
    diagnostics.scopes = data?.scopes ?? []
    diagnostics.granular_scopes = data?.granular_scopes ?? []
  } catch (error) {
    diagnostics.debug_token_error = error instanceof Error ? error.message : String(error)
  }

  try {
    const me = await metaRequest(`${baseUrl}/me?fields=id`, accessToken)
    diagnostics.token_owner_id = me.id ?? null

    try {
      const assigned = await metaRequest(
        `${baseUrl}/${encodeURIComponent(String(me.id))}/assigned_whatsapp_business_accounts?fields=id,phone_numbers{id}`,
        accessToken
      )
      diagnostics.assigned_wabas = assigned.data ?? []
    } catch (error) {
      diagnostics.assigned_wabas_error = error instanceof Error ? error.message : String(error)
    }
  } catch (error) {
    diagnostics.token_owner_error = error instanceof Error ? error.message : String(error)
  }

  try {
    const businesses = await metaRequest(`${baseUrl}/me/businesses?fields=id,name`, accessToken)
    const rows = Array.isArray(businesses.data)
      ? businesses.data as Array<{ id?: string; name?: string }>
      : []
    diagnostics.businesses = rows
    const edges = []
    for (const business of rows) {
      if (!business.id) continue
      for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
        try {
          const response = await metaRequest(
            `${baseUrl}/${encodeURIComponent(business.id)}/${edge}?fields=id,name,phone_numbers{id}`,
            accessToken
          )
          edges.push({ business_id: business.id, edge, data: response.data ?? [] })
        } catch (error) {
          edges.push({
            business_id: business.id,
            edge,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
    diagnostics.business_waba_edges = edges
  } catch (error) {
    diagnostics.businesses_error = error instanceof Error ? error.message : String(error)
  }

  return diagnostics
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accessToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim()
  const graphVersion = process.env.WHATSAPP_CLOUD_GRAPH_VERSION?.trim() || 'v23.0'

  if (!accessToken || !phoneNumberId) {
    return Response.json({ error: 'WhatsApp Cloud API is not configured.' }, { status: 503 })
  }

  try {
    const input = await request.json().catch(() => ({})) as { waba_id?: unknown }
    const providedWabaId = typeof input.waba_id === 'string' && /^\d+$/.test(input.waba_id.trim())
      ? input.waba_id.trim()
      : null
    const wabaId = providedWabaId
      ?? await resolveWabaId(graphVersion, phoneNumberId, accessToken)

    if (!wabaId) {
      const diagnostics = await diagnoseWabaResolution(graphVersion, phoneNumberId, accessToken)
      return Response.json({
        error: 'WhatsApp Business Account was not returned by Meta.',
        diagnostics,
      }, { status: 502 })
    }

    const results = []
    for (const definition of templateDefinitions) {
      const existing = await metaRequest(
        `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(definition.name)}&limit=100`,
        accessToken
      )
      const templates = Array.isArray(existing.data) ? existing.data as Array<Record<string, unknown>> : []
      const match = templates.find((template) => template.name === definition.name && template.language === definition.language)

      if (match) {
        results.push({
          name: definition.name,
          action: 'existing',
          id: match.id ?? null,
          status: match.status ?? null,
          category: match.category ?? null,
        })
        continue
      }

      const created = await metaRequest(
        `https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(wabaId)}/message_templates`,
        accessToken,
        { method: 'POST', body: JSON.stringify(definition) }
      )
      results.push({
        name: definition.name,
        action: 'created',
        id: created.id ?? null,
        status: created.status ?? null,
        category: created.category ?? definition.category,
      })
    }

    return Response.json({ ok: true, waba_id: wabaId, templates: results })
  } catch (error) {
    console.error('Could not synchronize WhatsApp appointment templates.', error)
    return Response.json({
      error: 'Could not synchronize WhatsApp appointment templates.',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 502 })
  }
}
