import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose'
import { query } from '../database/pg.js'
import { logError } from '../utils/logger.js'
import { sendError } from '../utils/http.js'

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || ''
const COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID || ''
const REGION = USER_POOL_ID.split('_')[0] || 'us-east-1'
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`

let jwks = null
let jwksInitPromise = null

// Pre-fetch JWKS during module initialization (runs during cold start, outside
// the handler's maxDuration clock). By the time the first HTTP request arrives,
// the key set is already in memory and jwtVerify makes zero network calls.
if (USER_POOL_ID) {
  jwksInitPromise = fetch(JWKS_URI)
    .then(r => r.json())
    .then(keySet => { jwks = createLocalJWKSet(keySet) })
    .catch(() => { jwks = createRemoteJWKSet(new URL(JWKS_URI)) })
}

async function getJwksAsync() {
  if (jwks) return jwks
  if (jwksInitPromise) {
    await jwksInitPromise
    if (jwks) return jwks
  }
  if (!USER_POOL_ID) return null
  jwks = createRemoteJWKSet(new URL(JWKS_URI))
  return jwks
}

/**
 * Resolves a Cognito sub + email to the canonical users.id.
 * Priority: cognito_sub match → email match (and backfill cognito_sub) → create new.
 */
async function resolveUserId(cognitoSub, email) {
  // 1. Already linked by cognito_sub
  const bySub = await query(
    'SELECT id, email FROM users WHERE cognito_sub = $1',
    [cognitoSub]
  )
  if (bySub.rows.length > 0) return bySub.rows[0]

  // 2. Match by email — legacy user from Supabase migration
  if (email) {
    const byEmail = await query(
      'SELECT id, email FROM users WHERE email = $1 AND cognito_sub IS NULL',
      [email]
    )
    if (byEmail.rows.length > 0) {
      await query('UPDATE users SET cognito_sub = $1 WHERE id = $2', [cognitoSub, byEmail.rows[0].id])
      return byEmail.rows[0]
    }
  }

  // 3. New user — create row using cognito_sub as id
  const created = await query(
    'INSERT INTO users (id, email, cognito_sub) VALUES ($1, $2, $1) ON CONFLICT (id) DO NOTHING RETURNING id, email',
    [cognitoSub, email || '']
  )
  if (created.rows.length > 0) return created.rows[0]

  return { id: cognitoSub, email: email || '' }
}

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendError(res, { status: 401, message: 'Missing or invalid authorization header' })
    }

    const token = authHeader.substring(7)

    const ks = await getJwksAsync()
    if (!ks) {
      logError('Auth not configured: missing COGNITO_USER_POOL_ID')
      return sendError(res, { status: 500, message: 'Server authentication is not configured' })
    }

    const verifyOpts = { issuer: ISSUER }
    if (COGNITO_CLIENT_ID) verifyOpts.audience = COGNITO_CLIENT_ID
    const { payload } = await jwtVerify(token, ks, verifyOpts)

    const resolved = await resolveUserId(payload.sub, payload.email)

    req.user = { id: resolved.id, email: resolved.email }
    req.userId = resolved.id

    next()
  } catch (error) {
    const msg = error?.message || ''
    if (msg.includes('expired') || msg.includes('ERR_JWT_EXPIRED')) {
      return sendError(res, { status: 401, message: 'Token expired' })
    }
    logError('Authentication error', error)
    return sendError(res, { status: 401, message: 'Invalid or expired token' })
  }
}

// optionalAuth removed — defined but never used
