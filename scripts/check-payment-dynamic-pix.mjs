import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

process.env.MERCADO_PAGO_CLIENT_ID = '123456'
process.env.MERCADO_PAGO_CLIENT_SECRET = 'client-secret'
process.env.MERCADO_PAGO_OAUTH_REDIRECT_URI =
  'https://example.com/api/payment-providers/mercado-pago/callback'
process.env.MERCADO_PAGO_WEBHOOK_SECRET = 'webhook-secret'

const {
  createMercadoPagoPixPayment,
  getMercadoPagoPayment,
  getMercadoPagoWebhookUrl,
} = await import('../src/lib/payments/mercado-pago-payments.ts')
const {
  validateMercadoPagoWebhookSignature,
} = await import('../src/lib/payments/mercado-pago-webhook.ts')

assert.equal(
  getMercadoPagoWebhookUrl(),
  'https://example.com/api/payment-providers/mercado-pago/webhook'
)

const providerResponse = {
  id: 987654321,
  status: 'pending',
  status_detail: 'pending_waiting_transfer',
  external_reference: 'billing:cycle-id:pix:1',
  transaction_amount: 300,
  date_of_expiration: '2026-07-30T18:00:00.000Z',
  transaction_details: {
    net_received_amount: 295.5,
  },
  fee_details: [{ amount: 4.5 }],
  point_of_interaction: {
    transaction_data: {
      qr_code: '000201010212...',
      qr_code_base64: 'iVBORw0KGgo=',
      ticket_url: 'https://www.mercadopago.com.br/payments/987654321/ticket',
    },
  },
}

const requests = []
const fetchMock = async (url, init = {}) => {
  requests.push({ url: String(url), init })
  return Response.json(providerResponse, { status: init.method === 'POST' ? 201 : 200 })
}

const created = await createMercadoPagoPixPayment(
  { accessToken: 'APP_USR-example' },
  {
    tenantId: 'tenant-id',
    connectionId: 'connection-id',
    billingCycleId: 'cycle-id',
    customerId: 'customer-id',
    externalReference: 'billing:cycle-id:pix:1',
    paymentMethod: 'pix',
    amountCents: 30000,
    dueDate: '2026-07-29',
    description: 'Mensalidade de Cliente Teste',
    payer: {
      name: 'Cliente Teste',
      email: 'cliente@example.com',
      cpf: '123.456.789-09',
    },
  },
  '11111111-1111-5111-8111-111111111111',
  fetchMock
)

assert.equal(created.providerChargeId, '987654321')
assert.equal(created.status, 'pending')
assert.equal(created.amountCents, 30000)
assert.equal(created.feeCents, 450)
assert.equal(created.netAmountCents, 29550)
assert.equal(created.pixCopyPaste, '000201010212...')

const createRequest = requests[0]
assert.equal(createRequest.url, 'https://api.mercadopago.com/v1/payments')
assert.equal(createRequest.init.method, 'POST')
assert.equal(
  createRequest.init.headers['X-Idempotency-Key'],
  '11111111-1111-5111-8111-111111111111'
)
assert.equal(
  createRequest.init.headers.Authorization,
  'Bearer APP_USR-example'
)

const createBody = JSON.parse(createRequest.init.body)
assert.equal(createBody.payment_method_id, 'pix')
assert.equal(createBody.transaction_amount, 300)
assert.equal(createBody.external_reference, 'billing:cycle-id:pix:1')
assert.equal(createBody.payer.identification.number, '12345678909')
assert.equal(
  createBody.notification_url,
  'https://example.com/api/payment-providers/mercado-pago/webhook'
)

await getMercadoPagoPayment(
  { accessToken: 'APP_USR-example' },
  '987654321',
  fetchMock
)
assert.equal(
  requests[1].url,
  'https://api.mercadopago.com/v1/payments/987654321'
)

const dataId = '987654321'
const requestId = 'request-id-example'
const timestamp = '1753815600'
const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
const digest = createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
  .update(manifest)
  .digest('hex')

assert.equal(
  validateMercadoPagoWebhookSignature({
    xSignature: `ts=${timestamp},v1=${digest}`,
    xRequestId: requestId,
    dataId,
  }),
  true
)
assert.equal(
  validateMercadoPagoWebhookSignature({
    xSignature: `ts=${timestamp},v1=${'0'.repeat(64)}`,
    xRequestId: requestId,
    dataId,
  }),
  false
)

console.log('Dynamic Pix, idempotency and webhook signature checks passed.')

