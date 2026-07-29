import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

type SignatureParts = {
  ts: string
  v1: string
}

function parseSignature(value: string): SignatureParts | null {
  const parts = new Map(
    value.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=')
      return [key, rest.join('=')]
    })
  )
  const ts = parts.get('ts')
  const v1 = parts.get('v1')
  return ts && v1 ? { ts, v1 } : null
}

export function isMercadoPagoWebhookConfigured() {
  return Boolean(process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim())
}

export function validateMercadoPagoWebhookSignature(input: {
  xSignature: string | null
  xRequestId: string | null
  dataId: string
}) {
  const secret = process.env.MERCADO_PAGO_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new Error('O segredo de webhook do Mercado Pago não está configurado.')
  }

  const signature = input.xSignature
    ? parseSignature(input.xSignature)
    : null

  if (!signature || !input.xRequestId || !input.dataId) return false

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.xRequestId};ts:${signature.ts};`
  const expected = createHmac('sha256', secret)
    .update(manifest)
    .digest('hex')

  const receivedBuffer = Buffer.from(signature.v1, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  )
}

