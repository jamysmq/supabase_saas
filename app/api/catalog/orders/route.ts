import { requireTenantUser, tenantCanUseRestaurant } from '../../../../src/lib/tenant-admin'
import { parseMoneyToCents } from '../../../../src/lib/money'

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

function parsePriceCents(value: unknown) {
  const amountCents = parseMoneyToCents(value)

  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return NaN
  }

  return amountCents
}

type RequestedOrderItem = {
  menu_item_id?: unknown
  quantity?: unknown
}

export async function GET(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Pedidos disponíveis apenas no plano restaurante.', 403)
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  let query = result.supabase
    .from('tenant_restaurant_orders')
    .select(`
      id,
      customer_name,
      customer_phone_e164,
      delivery_address,
      notes,
      subtotal_cents,
      delivery_fee_cents,
      total_cents,
      currency,
      payment_method,
      status,
      source,
      confirmed_at,
      paid_at,
      cancelled_at,
      created_at,
      tenant_restaurant_order_items (
        id,
        menu_group_name_snapshot,
        item_name_snapshot,
        item_description_snapshot,
        unit_price_cents,
        quantity,
        total_cents,
        notes
      )
    `)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .order('confirmed_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    return errorResponse('Não foi possível listar os pedidos.', 500, error.message)
  }

  const { data: revenue, error: revenueError } = await result.supabase
    .from('tenant_restaurant_order_revenue_events')
    .select('id, order_id, total_cents, payment_method, status, recognized_at, voided_at')
    .eq('tenant_id', result.tenantUser.tenant_id)
    .order('recognized_at', { ascending: false })

  if (revenueError) {
    return errorResponse('Não foi possível listar o financeiro dos pedidos.', 500, revenueError.message)
  }

  return Response.json({
    orders: data ?? [],
    revenueEvents: revenue ?? [],
  })
}

export async function POST(request: Request) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Pedidos disponíveis apenas no plano restaurante.', 403)
  }

  const body = await request.json().catch(() => null)
  const customerName = String(body?.customer_name ?? '').trim()
  const customerPhone = String(body?.customer_phone_e164 ?? '').replace(/\D/g, '')
  const deliveryAddress = String(body?.delivery_address ?? '').trim() || null
  const notes = String(body?.notes ?? '').trim() || null
  const paymentMethod = String(body?.payment_method ?? 'cash_on_delivery').trim()
  const requestedItems: RequestedOrderItem[] = Array.isArray(body?.items) ? body.items : []
  const hasStructuredItems = requestedItems.length > 0
  const totalCents = hasStructuredItems ? 0 : parsePriceCents(body?.total ?? body?.total_cents)
  const itemName = String(body?.item_name ?? 'Pedido manual').trim()

  if (!customerName) {
    return errorResponse('Informe o nome do cliente.')
  }

  if (!hasStructuredItems && (Number.isNaN(totalCents) || totalCents <= 0)) {
    return errorResponse('Valor total inválido.')
  }

  const cartItemIds = Array.from(
    new Set(
      requestedItems
        .map((item) => String(item?.menu_item_id ?? '').trim())
        .filter(Boolean)
    )
  )
  const quantityByItemId = new Map<string, number>()

  for (const item of requestedItems) {
    const menuItemId = String(item?.menu_item_id ?? '').trim()
    const quantity = Number(item?.quantity ?? 0)

    if (!menuItemId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 99) {
      return errorResponse('Itens do pedido inválidos.')
    }

    quantityByItemId.set(menuItemId, (quantityByItemId.get(menuItemId) ?? 0) + quantity)
  }

  const menuItemsById = new Map<string, {
    id: string
    name: string
    description: string | null
    price_cents: number
    tenant_menu_groups: { name: string | null } | { name: string | null }[] | null
  }>()

  if (hasStructuredItems) {
    const { data: menuItems, error: menuItemsError } = await result.supabase
      .from('tenant_menu_items')
      .select(`
        id,
        name,
        description,
        price_cents,
        tenant_menu_groups (
          name
        )
      `)
      .eq('tenant_id', result.tenantUser.tenant_id)
      .eq('is_active', true)
      .in('id', cartItemIds)

    if (menuItemsError) {
      return errorResponse('Não foi possível validar os itens do pedido.', 500, menuItemsError.message)
    }

    for (const menuItem of menuItems ?? []) {
      menuItemsById.set(menuItem.id, menuItem)
    }

    if (menuItemsById.size !== cartItemIds.length) {
      return errorResponse('Um ou mais itens do pedido não estão disponíveis.')
    }
  }

  const structuredTotalCents = Array.from(quantityByItemId.entries()).reduce((sum, [menuItemId, quantity]) => {
    const menuItem = menuItemsById.get(menuItemId)
    return sum + (menuItem?.price_cents ?? 0) * quantity
  }, 0)
  const finalTotalCents = hasStructuredItems ? structuredTotalCents : totalCents

  if (finalTotalCents <= 0) {
    return errorResponse('Valor total inválido.')
  }

  const { data: order, error: orderError } = await result.supabase
    .from('tenant_restaurant_orders')
    .insert({
      tenant_id: result.tenantUser.tenant_id,
      customer_name: customerName,
      customer_phone_e164: customerPhone || null,
      delivery_address: deliveryAddress,
      notes,
      subtotal_cents: finalTotalCents,
      delivery_fee_cents: 0,
      total_cents: finalTotalCents,
      payment_method: paymentMethod,
      status: 'confirmed',
      source: 'panel',
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (orderError || !order) {
    return errorResponse('Não foi possível criar o pedido.', 500, orderError?.message)
  }

  const orderItemsPayload = hasStructuredItems
    ? Array.from(quantityByItemId.entries()).map(([menuItemId, quantity]) => {
        const menuItem = menuItemsById.get(menuItemId)
        const relation = menuItem?.tenant_menu_groups
        const group = Array.isArray(relation) ? relation[0] ?? null : relation ?? null

        return {
          order_id: order.id,
          tenant_id: result.tenantUser.tenant_id,
          menu_item_id: menuItemId,
          menu_group_name_snapshot: group?.name ?? null,
          item_name_snapshot: menuItem?.name ?? 'Item',
          item_description_snapshot: menuItem?.description ?? null,
          unit_price_cents: menuItem?.price_cents ?? 0,
          quantity,
          total_cents: (menuItem?.price_cents ?? 0) * quantity,
        }
      })
    : [{
        order_id: order.id,
        tenant_id: result.tenantUser.tenant_id,
        item_name_snapshot: itemName || 'Pedido manual',
        unit_price_cents: totalCents,
        quantity: 1,
        total_cents: totalCents,
        notes,
      }]

  const { error: itemError } = await result.supabase
    .from('tenant_restaurant_order_items')
    .insert(orderItemsPayload)

  if (itemError) {
    return errorResponse('Pedido criado, mas não foi possível criar o item.', 500, itemError.message)
  }

  await result.supabase
    .from('tenant_restaurant_order_events')
    .insert({
      order_id: order.id,
      tenant_id: result.tenantUser.tenant_id,
      tenant_user_id: result.tenantUser.id,
      old_status: null,
      new_status: 'confirmed',
      source: 'panel',
      note: 'Pedido inserido manualmente.',
    })

  return Response.json({ order_id: order.id })
}
