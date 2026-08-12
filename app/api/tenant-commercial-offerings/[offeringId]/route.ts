import { requireTenantUser } from '../../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

const offerTypes = new Set(['membership', 'rental'])
const priceUnits = new Set(['monthly', 'hourly', 'daily', 'per_class', 'per_session', 'package', 'one_time', 'custom'])
const selection = 'id, offer_type, name, description, price_cents, price_unit, custom_unit_label, is_active, sort_order, created_at, updated_at'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) console.error(message, details)
  return Response.json({ error: message, message }, { status })
}

export async function PUT(request: Request, context: { params: Promise<{ offeringId: string }> }) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error

  const { offeringId } = await context.params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return errorResponse('Dados inválidos. Recarregue a página e tente novamente.')

  const offerType = String(body.offer_type ?? '').trim()
  const name = String(body.name ?? '').trim()
  const description = String(body.description ?? '').trim() || null
  const priceCents = parseMoneyToCents(body.price)
  const priceUnit = String(body.price_unit ?? '').trim()
  const customUnitLabel = String(body.custom_unit_label ?? '').trim() || null
  const sortOrder = Number(body.sort_order ?? 0)

  if (!offerTypes.has(offerType)) return errorResponse('Escolha plano/modalidade ou aluguel.')
  if (!name || name.length > 80) return errorResponse('Informe um nome com até 80 caracteres.')
  if (description && description.length > 500) return errorResponse('A descrição deve ter até 500 caracteres.')
  if (!Number.isFinite(priceCents) || priceCents < 0) return errorResponse('Informe um preço válido.')
  if (!priceUnits.has(priceUnit)) return errorResponse('Escolha como o preço será cobrado.')
  if (priceUnit === 'custom' && !customUnitLabel) return errorResponse('Informe a unidade personalizada do preço.')
  if (!Number.isInteger(sortOrder)) return errorResponse('A ordem deve ser um número inteiro.')

  const { data, error } = await result.supabase
    .from('tenant_commercial_offerings')
    .update({
      offer_type: offerType,
      name,
      description,
      price_cents: priceCents,
      price_unit: priceUnit,
      custom_unit_label: priceUnit === 'custom' ? customUnitLabel : null,
      sort_order: sortOrder,
      is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offeringId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select(selection)
    .maybeSingle()

  if (error) return errorResponse('Não foi possível atualizar a oferta.', 500, error.message)
  if (!data) return errorResponse('Oferta não encontrada.', 404)
  return Response.json({ offering: data })
}

export async function DELETE(request: Request, context: { params: Promise<{ offeringId: string }> }) {
  const result = await requireTenantUser(request)
  if (result.error) return result.error
  const { offeringId } = await context.params

  const { data, error } = await result.supabase
    .from('tenant_commercial_offerings')
    .delete()
    .eq('id', offeringId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .select('id')
    .maybeSingle()

  if (error) return errorResponse('Não foi possível excluir a oferta.', 500, error.message)
  if (!data) return errorResponse('Oferta não encontrada.', 404)
  return Response.json({ ok: true })
}
