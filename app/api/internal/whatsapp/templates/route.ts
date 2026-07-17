type MetaErrorBody = {
  error?: {
    code?: number
    message?: string
    error_subcode?: number
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
      text: 'Olá, {{1}}! Lembrete: seu horário em {{2}} é hoje, às {{3}}. Serviço: {{4}}. Até já!',
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
        text: 'Olá, {{1}}! Seu agendamento em {{2}} está marcado para {{3}}, às {{4}}. Serviço: {{5}}.',
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
    }))
  }

  return body
}

async function resolveWabaId(graphVersion: string, phoneNumberId: string, accessToken: string) {
  const baseUrl = `https://graph.facebook.com/${encodeURIComponent(graphVersion)}`
  const accounts: Array<{ id?: string; phone_numbers?: { data?: Array<{ id?: string }> } }> = []

  const me = await metaRequest(`${baseUrl}/me?fields=id,business`, accessToken)
  const meId = typeof me.id === 'string' ? me.id : ''
  const ownerBusiness = me.business as { id?: string } | undefined
  const businessesToInspect = new Set<string>()
  if (ownerBusiness?.id) businessesToInspect.add(ownerBusiness.id)

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
    const wabaId = await resolveWabaId(graphVersion, phoneNumberId, accessToken)

    if (!wabaId) {
      return Response.json({ error: 'WhatsApp Business Account was not returned by Meta.' }, { status: 502 })
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
