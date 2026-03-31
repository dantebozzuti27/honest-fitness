import { createRemoteJWKSet, jwtVerify } from 'jose'
import { query } from './db.js'

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || ''
const REGION = USER_POOL_ID.split('_')[0] || 'us-east-1'
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`

let jwks = null

function getJwks() {
  if (jwks) return jwks
  if (!USER_POOL_ID) return null
  jwks = createRemoteJWKSet(new URL(JWKS_URI))
  return jwks
}

export async function verifyToken(token) {
  const ks = getJwks()
  if (!ks) throw new Error('JWKS not configured')
  const { payload } = await jwtVerify(token, ks, { issuer: ISSUER })
  return payload
}

async function resolveUserId(cognitoSub, email) {
  try {
    const bySub = await query('SELECT id, email FROM users WHERE cognito_sub = $1', [cognitoSub])
    if (bySub.rows.length > 0) return bySub.rows[0]

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

    const created = await query(
      'INSERT INTO users (id, email, cognito_sub) VALUES ($1, $2, $1) ON CONFLICT (id) DO NOTHING RETURNING id, email',
      [cognitoSub, email || '']
    )
    if (created.rows.length > 0) return created.rows[0]
  } catch {
    // fallback
  }
  return { id: cognitoSub, email: email || '' }
}

export async function extractUser(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null
  }
  const token = authHeader.slice(7).trim()
  if (!token || !USER_POOL_ID) return null

  const payload = await verifyToken(token)
  return resolveUserId(payload.sub, payload.email)
}
