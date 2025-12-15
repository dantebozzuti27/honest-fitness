import crypto from 'crypto'

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function unb64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4))
  const s = (str + pad).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(s, 'base64')
}

export function createSignedOAuthState({ userId, secret }) {
  if (!secret) throw new Error('Missing OAUTH_STATE_SECRET')
  if (!userId) throw new Error('Missing userId')

  const ts = Date.now().toString()
  const nonce = b64url(crypto.randomBytes(16))
  const payload = `${userId}.${ts}.${nonce}`
  const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  return `${payload}.${sig}`
}

export function verifySignedOAuthState({ state, secret, maxAgeMs = 10 * 60 * 1000 }) {
  if (!secret) throw new Error('Missing OAUTH_STATE_SECRET')
  if (!state || typeof state !== 'string') throw new Error('Missing state')

  const parts = state.split('.')
  if (parts.length !== 4) return { ok: false, reason: 'invalid_format' }

  const [userId, tsStr, nonce, sig] = parts
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(userId)) return { ok: false, reason: 'invalid_user' }
  if (!/^\d{10,}$/.test(tsStr)) return { ok: false, reason: 'invalid_ts' }
  // ensure nonce is valid base64url-ish
  try {
    unb64url(nonce)
  } catch {
    return { ok: false, reason: 'invalid_nonce' }
  }

  const ts = Number(tsStr)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_ts' }
  const age = Date.now() - ts
  if (age < 0 || age > maxAgeMs) return { ok: false, reason: 'expired' }

  const payload = `${userId}.${tsStr}.${nonce}`
  const expected = b64url(crypto.createHmac('sha256', secret).update(payload).digest())
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  return ok ? { ok: true, userId } : { ok: false, reason: 'bad_sig' }
}


