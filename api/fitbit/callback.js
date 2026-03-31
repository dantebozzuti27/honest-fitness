import { verifySignedOAuthState } from '../_utils/oauthState.js'
import { query } from '../_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  if (error) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent('No authorization code received')}`)
  }

  // CSRF protection: signed state required (generated server-side).
  const secret = process.env.OAUTH_STATE_SECRET
  const allowLegacy = process.env.ALLOW_LEGACY_OAUTH_STATE === 'true'
  let userId = null

  if (typeof state === 'string' && secret) {
    const verified = verifySignedOAuthState({ state, secret, maxAgeMs: 10 * 60 * 1000 })
    if (verified.ok) {
      userId = verified.userId
    } else if (!allowLegacy) {
      console.error('OAuth state verification failed', verified.reason)
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid OAuth state. Please try connecting again.')}`)
    }
  }

  if (!userId) {
    // Legacy fallback (NOT recommended; allow only if explicitly enabled).
    if (!allowLegacy) {
      return res.redirect(`/?fitbit_error=${encodeURIComponent('OAuth state not configured. Please contact support.')}`)
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!state || typeof state !== 'string' || !uuidRegex.test(state)) {
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid state parameter')}`)
    }
    userId = state
  }

  try {
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        redirect_uri: process.env.FITBIT_REDIRECT_URI,
        code: code
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Fitbit token exchange error:', errorData)
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Failed to exchange token')}`)
    }

    const tokenData = await tokenResponse.json()

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 28800))

    try {
      await query(
        `INSERT INTO connected_accounts (user_id, provider, access_token, refresh_token, expires_at, token_type, scope, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           token_type = EXCLUDED.token_type,
           scope = EXCLUDED.scope,
           updated_at = EXCLUDED.updated_at`,
        [userId, 'fitbit', tokenData.access_token, tokenData.refresh_token,
         expiresAt.toISOString(), tokenData.token_type || 'Bearer',
         tokenData.scope || null, new Date().toISOString()]
      )
    } catch (dbError) {
      console.error('Database error:', dbError)
      return res.redirect(`/?fitbit_error=${encodeURIComponent(`Failed to save connection: ${dbError.message || 'Database error'}`)}`)
    }

    return res.redirect(`/wearables?fitbit_connected=true`)

  } catch (error) {
    console.error('Fitbit callback error:', error)
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}
