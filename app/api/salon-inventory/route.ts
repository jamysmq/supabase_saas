import { requireTenantUser, tenantCanUseInventory } from '../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parseQuantity(value: unknown) {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.')

  return Number(normalized)
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseInventory(result.tenant)) {
    return errorResponse('Estoque não disponível para este plano.', 403)
  }

  const [productsResult, movementsResult] = await Promise.all([
    result.supabase
      .from('tenant_salon_inventory_products')
      .select('id, name, sku, current_quantity, unit_cost_cents, total_cost_cents, is_active, updated_at, created_at')
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
    result.supabase
      .from('tenant_salon_inventory_movements')
      .select(`
        id,
        product_id,
        movement_type,
        quantity_delta,
        unit_cost_cents,
        total_cost_cents,
        supplier,
        notes,
        tenant_user_id,
        source,
        created_at,
        product:tenant_salon_inventory_products(name, sku)
      `)
      .eq('tenant_id', result.tenantUser.tenant_id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (productsResult.error) {
    return errorResponse('Nao foi possivel listar o estoque.', 500, productsResult.error.message)
  }

  if (movementsResult.error) {
    return errorResponse('Nao foi possivel listar o historico de estoque.', 500, movementsResult.error.message)
  }

  return Response.json({
    products: productsResult.data ?? [],
    movements: movementsResult.data ?? [],
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseInventory(result.tenant)) {
    return errorResponse('Estoque não disponível para este plano.', 403)
  }

  const body = await request.json().catch(() => null)

  if (!body) {
    return errorResponse('Dados invalidos. Recarregue a pagina e tente novamente.')
  }

  const action = String(body.action || 'purchase').trim()
  const notes = String(body.notes || '').trim()
  const quantity = parseQuantity(body.quantity)
  const idempotencyKey = String(
    request.headers.get('x-idempotency-key') || body.idempotency_key || ''
  ).trim() || null

  if (idempotencyKey && idempotencyKey.length > 200) {
    return errorResponse('Chave de idempotência inválida.')
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return errorResponse('Informe uma quantidade maior que zero.')
  }

  if (action === 'usage') {
    const productId = String(body.product_id || '').trim()

    if (!productId) {
      return errorResponse('Selecione o produto para registrar a saída.')
    }

    const { data, error } = await result.supabase.rpc(
      'admin_create_inventory_usage',
      {
        p_tenant_id: result.tenantUser.tenant_id,
        p_tenant_user_id: result.tenantUser.id,
        p_product_id: productId,
        p_quantity: quantity,
        p_notes: notes || null,
        p_idempotency_key: idempotencyKey,
        p_source: 'panel',
      }
    )

    if (error) {
      if (error.message.includes('insufficient_inventory')) {
        return errorResponse('Saldo insuficiente para registrar esta saída.', 409)
      }

      if (error.message.includes('inventory_product_not_found')) {
        return errorResponse('Produto não encontrado.', 404)
      }

      return errorResponse('Não foi possível registrar a saída de estoque.', 500, error.message)
    }

    return Response.json({ ok: true, result: data?.[0] ?? null })
  }

  if (action !== 'purchase') {
    return errorResponse('Tipo de movimentação inválido.')
  }

  const name = String(body.name || '').trim()
  const sku = String(body.sku || '').trim()
  const supplier = String(body.supplier || '').trim()
  const unitCostCents = parseMoneyToCents(body.unit_cost)

  if (!name || name.length > 120) {
    return errorResponse('Informe o nome do produto.')
  }

  if (!Number.isFinite(unitCostCents) || unitCostCents <= 0) {
    return errorResponse('Informe o valor unitario do produto.')
  }

  const { data, error } = await result.supabase.rpc(
    'admin_create_inventory_purchase',
    {
      p_tenant_id: result.tenantUser.tenant_id,
      p_tenant_user_id: result.tenantUser.id,
      p_name: name,
      p_quantity: quantity,
      p_unit_cost_cents: unitCostCents,
      p_sku: sku || null,
      p_supplier: supplier || null,
      p_notes: notes || null,
      p_idempotency_key: idempotencyKey,
      p_source: 'panel',
    }
  )

  if (error) {
    return errorResponse('Nao foi possivel registrar a entrada de estoque.', 500, error.message)
  }

  return Response.json({ ok: true, result: data?.[0] ?? null })
}
