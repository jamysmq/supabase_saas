import 'server-only'

import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const PAYMENT_OAUTH_STATE_TTL_MINUTES = 10

export function hashOAuthState(state: string) {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

export function createPaymentOAuthAttempt() {
  const id = randomUUID()
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(64).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier, 'ascii')
    .digest('base64url')
  const expiresAt = new Date(
    Date.now() + PAYMENT_OAUTH_STATE_TTL_MINUTES * 60 * 1000
  ).toISOString()

  return {
    id,
    state,
    stateHash: hashOAuthState(state),
    codeVerifier,
    codeChallenge,
    expiresAt,
  }
}

export function getOAuthStateEncryptionContext(
  stateId: string,
  tenantId: string,
  provider: string
) {
  return `oauth-state:${provider}:${tenantId}:${stateId}`
}
