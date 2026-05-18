import { requireTenantUser, tenantCanUseRestaurant } from '../../../../../src/lib/tenant-admin'

const allowedActions = new Set(['pay', 'cancel'])

function errorResponse(message: string, status = 400, details?: string) {
  if (details) {
    console.error(message, details)
  }

  return Response.json({ error: message, message }, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ orderId: string }> }
) {
  const result = await requireTenantUser(request)

  if (result.error) return result.error

  if (!tenantCanUseRestaurant(result.tenant)) {
    return errorResponse('Pedidos disponíveis apenas no plano restaurante.', 403)
  }

  const { orderId } = await context.params
  const body = await request.json().catch(() => null)
  const action = String(body?.action ?? '').trim()
  const paymentMethod = String(body?.payment_method ?? '').trim()

  if (!allowedActions.has(action)) {
    return errorResponse('Ação inválida para pedido.')
  }

  const { data: order, error: orderError } = await result.supabase
    .from('tenant_restaurant_orders')
    .select('id, status, payment_method')
    .eq('id', orderId)
    .eq('tenant_id', result.tenantUser.tenant_id)
    .maybeSingle()

  if (orderError || !order) {
    return errorResponse('Pedido não encontrado.', 404, orderError?.message)
  }

  const nextStatus = action === 'pay' ? 'paid' : 'cancelled'
  const now = new Date().toISOString()

  const { error: updateError } = await result.supabase
    .from('tenant_restaurant_orders')
    .update({
      status: nextStatus,
      payment_method: paymentMethod || order.payment_method,
      paid_at: nextStatus === 'paid' ? now : null,
      cancelled_at: nextStatus === 'cancelled' ? now : null,
      updated_at: now,
    })
    .eq('id', orderId)
    .eq('tenant_id', result.tenantUser.tenant_id)

  if (updateError) {
    return errorResponse('Não foi possível atualizar o pedido.', 500, updateError.message)
  }

  await result.supabase
    .from('tenant_restaurant_order_events')
    .insert({
      order_id: orderId,
      tenant_id: result.tenantUser.tenant_id,
      tenant_user_id: result.tenantUser.id,
      old_status: order.status,
      new_status: nextStatus,
      source: 'panel',
      note: nextStatus === 'paid'
        ? 'Pagamento/entrega confirmado manualmente.'
        : 'Pedido cancelado manualmente.',
    })

  const { error: revenueError } = await result.supabase.rpc(
    'admin_sync_restaurant_order_revenue',
    {
      p_order_id: orderId,
      p_source: 'panel',
    }
  )

  if (revenueError) {
    console.error('Não foi possível sincronizar financeiro do pedido.', revenueError.message)
  }

  return Response.json({ ok: true })
}
