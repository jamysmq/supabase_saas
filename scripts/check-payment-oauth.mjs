import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'

process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY =
  randomBytes(32).toString('base64')

const {
  decryptSensitiveJson,
  encryptSensitiveJson,
} = await import('../src/lib/payments/credential-crypto.ts')
const {
  createMercadoPagoAuthorizationUrl,
  exchangeMercadoPagoAuthorizationCode,
  getMercadoPagoAccount,
  refreshMercadoPagoAccessToken,
} = await import('../src/lib/payments/mercado-pago-oauth.ts')
const {
  createPaymentOAuthAttempt,
  getOAuthStateEncryptionContext,
  hashOAuthState,
} = await import('../src/lib/payments/oauth-state.ts')

const attempt = createPaymentOAuthAttempt()
assert.equal(attempt.stateHash, hashOAuthState(attempt.state))
assert.notEqual(attempt.stateHash, attempt.state)
assert.equal(
  attempt.codeChallenge,
  createHash('sha256').update(attempt.codeVerifier, 'ascii').digest('base64url')
)
assert.ok(attempt.codeVerifier.length >= 43)
assert.ok(attempt.codeVerifier.length <= 128)

const context = getOAuthStateEncryptionContext(
  attempt.id,
  'tenant-example',
  'mercado_pago'
)
const encrypted = encryptSensitiveJson(
  { codeVerifier: attempt.codeVerifier },
  context
)
assert.ok(!encrypted.includes(attempt.codeVerifier))
assert.deepEqual(
  decryptSensitiveJson(encrypted, context),
  { codeVerifier: attempt.codeVerifier }
)
assert.throws(() =>
  decryptSensitiveJson(encrypted, `${context}:different`)
)

const authorizationUrl = new URL(
  createMercadoPagoAuthorizationUrl({
    clientId: '123456',
    redirectUri:
      'https://example.com/api/payment-providers/mercado-pago/callback',
    state: attempt.state,
    codeChallenge: attempt.codeChallenge,
  })
)

assert.equal(authorizationUrl.protocol, 'https:')
assert.equal(authorizationUrl.hostname, 'auth.mercadopago.com')
assert.equal(authorizationUrl.searchParams.get('client_id'), '123456')
assert.equal(authorizationUrl.searchParams.get('state'), attempt.state)
assert.equal(
  authorizationUrl.searchParams.get('code_challenge_method'),
  'S256'
)
assert.equal(
  authorizationUrl.searchParams.get('code_challenge'),
  attempt.codeChallenge
)

const requests = []
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), init })

  if (String(url).endsWith('/oauth/token')) {
    return Response.json({
      access_token: 'APP_USR-example',
      refresh_token: 'TG-example',
      token_type: 'bearer',
      expires_in: 15552000,
      scope: 'read write offline_access',
      user_id: 123456,
      live_mode: true,
    })
  }

  return Response.json({
    id: 123456,
    nickname: 'CONTA_EXEMPLO',
    site_id: 'MLB',
  })
}

const config = {
  clientId: '123456',
  clientSecret: 'client-secret',
  redirectUri:
    'https://example.com/api/payment-providers/mercado-pago/callback',
}
const token = await exchangeMercadoPagoAuthorizationCode({
  config,
  code: 'authorization-code',
  codeVerifier: attempt.codeVerifier,
})
assert.equal(token.userId, '123456')
assert.equal(token.liveMode, true)
assert.deepEqual(token.scope, ['read', 'write', 'offline_access'])

const exchangeBody = JSON.parse(requests[0].init.body)
assert.equal(exchangeBody.grant_type, 'authorization_code')
assert.equal(exchangeBody.code_verifier, attempt.codeVerifier)
assert.equal(exchangeBody.redirect_uri, config.redirectUri)

await refreshMercadoPagoAccessToken({
  config,
  refreshToken: 'TG-example',
})
const refreshBody = JSON.parse(requests[1].init.body)
assert.deepEqual(Object.keys(refreshBody).sort(), [
  'client_id',
  'client_secret',
  'grant_type',
  'refresh_token',
])
assert.equal(refreshBody.grant_type, 'refresh_token')

const account = await getMercadoPagoAccount(
  token.accessToken,
  token.userId
)
assert.deepEqual(account, {
  id: '123456',
  displayName: 'CONTA_EXEMPLO',
  siteId: 'MLB',
})
assert.equal(
  requests[2].init.headers.Authorization,
  'Bearer APP_USR-example'
)

console.log('Payment OAuth state, PKCE and encryption checks passed.')
