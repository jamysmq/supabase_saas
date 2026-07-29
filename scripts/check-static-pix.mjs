import assert from 'node:assert/strict'
import {
  createStaticPixPayload,
  normalizePixKey,
} from '../src/lib/payments/pix-br-code.ts'

const officialBcbExample =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D'

assert.equal(
  createStaticPixPayload({
    key: '123e4567-e12b-12d1-a456-426655440000',
    keyType: 'random',
    merchantName: 'Fulano de Tal',
    merchantCity: 'BRASILIA',
  }),
  officialBcbExample
)

assert.equal(normalizePixKey('(11) 99999-9999', 'phone'), '+5511999999999')
assert.throws(() => normalizePixKey('111.111.111-11', 'cpf'))

const chargePayload = createStaticPixPayload({
  key: 'pix@example.com',
  keyType: 'email',
  merchantName: 'Empresa Exemplo',
  merchantCity: 'Fortaleza',
  amountCents: 30000,
  txid: 'BILL1234567890',
})

assert.match(chargePayload, /5406300\.00/)
assert.match(chargePayload, /62180514BILL1234567890/)
assert.match(chargePayload, /6304[A-F0-9]{4}$/)

console.log('Static Pix BR Code checks passed.')
