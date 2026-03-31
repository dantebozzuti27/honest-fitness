/**
 * Oura OAuth Start (server-signed state)
 * Returns an authorization URL with a signed `state`.
 */

import { extractUser } from '../_shared/auth.js'
import { createSignedOAuthState } from '../_utils/oauthState.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  try {
    const user = await extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }

    const clientId = process.env.OURA_CLIENT_ID || process.env.VITE_OURA_CLIENT_ID
    const redirectUri = process.env.OURA_REDIRECT_URI || process.env.VITE_OURA_REDIRECT_URI
    if (!clientId || !redirectUri) {
      return res.status(500).json({ success: false, error: { message: 'Oura OAuth not configured', status: 500 } })
    }

    const secret = process.env.OAUTH_STATE_SECRET
    const state = createSignedOAuthState({ userId: user.id, secret })

    const scopes = 'personal daily session'
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: scopes,
      state
    })

    const url = `https://cloud.ouraring.com/oauth/authorize?${params.toString()}`
    return res.status(200).json({ success: true, url })
  } catch (error) {
    return res.status(500).json({ success: false, error: { message: error?.message || 'Internal server error', status: 500 } })
  }
}


