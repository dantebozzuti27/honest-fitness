import { verifySignedOAuthState } from '../_utils/oauthState.js'
import { query } from '../_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  if (error) {
    return res.redirect(`/?oura_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect(`/?oura_error=${encodeURIComponent('No authorization code received')}`)
  }

  const secret = process.env.OAUTH_STATE_SECRET
  const allowLegacy = process.env.ALLOW_LEGACY_OAUTH_STATE === 'true'
  let userId = null

  if (typeof state === 'string' && secret) {
    const verified = verifySignedOAuthState({ state, secret, maxAgeMs: 10 * 60 * 1000 })
    if (verified.ok) {
      userId = verified.userId
    } else if (!allowLegacy) {
      console.error('OAuth state verification failed', verified.reason)
      return res.redirect(`/?oura_error=${encodeURIComponent('Invalid OAuth state. Please try connecting again.')}`)
    }
  }

  if (!userId) {
    if (!allowLegacy) {
      return res.redirect(`/?oura_error=${encodeURIComponent('OAuth state not configured. Please contact support.')}`)
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!state || typeof state !== 'string' || !uuidRegex.test(state)) {
      return res.redirect(`/?oura_error=${encodeURIComponent('Invalid state parameter')}`)
    }
    userId = state
  }

  try {
    if (!process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET || !process.env.OURA_REDIRECT_URI) {
      console.error('OAuth configuration error: Missing required credentials')
      return res.redirect(`/?oura_error=${encodeURIComponent('Server configuration error - OAuth not properly configured')}`)
    }

    const basicAuth = Buffer.from(
      `${process.env.OURA_CLIENT_ID}:${process.env.OURA_CLIENT_SECRET}`
    ).toString('base64')

    const tokenResponse = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.OURA_REDIRECT_URI
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Oura token exchange error:', errorData)
      return res.redirect(`/?oura_error=${encodeURIComponent('Failed to exchange token')}`)
    }

    const tokenData = await tokenResponse.json()

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 86400))

    console.log(`OAuth connection successful for user: ${userId} at ${new Date().toISOString()}`)

    try {
      await query(
        `INSERT INTO connected_accounts (user_id, provider, access_token, refresh_token, expires_at, token_type, scope, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           access_token = $3,
           refresh_token = $4,
           expires_at = $5,
           token_type = $6,
           scope = $7,
           updated_at = $8`,
        [
          userId,
          'oura',
          tokenData.access_token,
          tokenData.refresh_token || null,
          expiresAt.toISOString(),
          tokenData.token_type || 'Bearer',
          tokenData.scope || null,
          new Date().toISOString()
        ]
      )
    } catch (dbError) {
      console.error('Database error:', dbError)
      return res.redirect(`/?oura_error=${encodeURIComponent(`Failed to save connection: ${dbError.message || 'Database error'}`)}`)
    }

    return res.redirect(`/wearables?oura_connected=true`)

  } catch (error) {
    console.error('Oura callback error:', error)
    return res.redirect(`/?oura_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}
