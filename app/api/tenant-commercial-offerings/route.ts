import { requireTenantUser } from '../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../src/lib/money'

const offerTypes = new Set(['membership', 'rental'])
const priceUnits = new Set([
  'monthly',
  'hourly',
  'daily',
  'per_class',
  'per_session',
  'package',
  'one_time',
  'custom',
])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

function parseOffering(body: Record<string, unknown>) {
  const offerType = String(body.offer_type ?? '').trim()
  const name = String(body.name ?? '').trim()
  const description = String(body.description ?? '').trim() || null
  const priceCents = parseMoneyToCents(body.price)
  const priceUnit = String(body.price_unit ?? '').trim()
  const customUnitLabel = String(body.custom_unit_label ?? '').trim() || null
  const sortOrder = Number(body.sort_order ?? 0)

  if (!offerTypes.has(offerType)) return { error: 'Escolha plano/modalidade ou aluguel.' }
  if (!name || name.length > 80) return { error: 'Informe um nome com até 80 caracteres.' }
  if (description && description.length > 500) return { error: 'A descrição deve ter até 500 caracteres.' }
  if (!Number.isFinite(priceCents) || priceCents < 0) return { error: 'Informe um preço válido.' }
  if (!priceUnits.has(priceUnit)) return { error: 'Escolha como o preço será cobrado.' }
  if (priceUnit === 'custom' && !customUnitLabel) return { error: 'Informe a unidade personalizada do preço.' }
  if (customUnitLabel && customUnitLabel.length > 40) return { error: 'A unidade personalizada deve ter até 40 caracteres.' }
  if (!Number.isInteger(sortOrder)) return { error: 'A ordem deve ser um número inteiro.' }

  return {
    value: {
      offer_type: offerType,
      name,
      description,
      price_cents: priceCents,
      price_unit: priceUnit,
      custom_unit_label: priceUnit === 'custom' ? customUnitLabel : null,
      sort_order: sortOrder,
      is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    },
  }
}

const selection = 'id, offer_type, name, description, price_cents, price_unit, custom_unit_label, is_active, sort_order, created_at, updated_at'

export async function GET(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  const { data, error } = await result.supabase
    .from('tenant_commercial_offerings')
    .select(selection)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .order('offer_type')
    .order('sort_order')
    .order('name')

  if (error) return errorResponse('Não foi possível carregar os planos e preços.', 500, error.message)
  return Response.json({ offerings: data ?? [] })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')

  const parsed = parseOffering(body)
  if (parsed.error || !parsed.value) return errorResponse(parsed.error ?? 'Dados inválidos.')

  const { data, error } = await result.supabase
    .from('tenant_commercial_offerings')
    .insert({ tenant_id: result.tenantUser.tenant_id, ...parsed.value })
    .select(selection)
    .single()

  if (error || !data) return errorResponse('Não foi possível criar a oferta.', 500, error?.message)
  return Response.json({ offering: data })
}
