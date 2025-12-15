/**
 * Fitbit OAuth Start (server-signed state)
 * Returns an authorization URL with a signed `state`.
 */

import { createClient } from '@supabase/supabase-js'
import { createSignedOAuthState } from '../_utils/oauthState.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed', success: false })
  }

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing authorization', success: false })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token', success: false })
    }

    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ message: 'Server configuration error', success: false })
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user?.id) {
      return res.status(401).json({ message: 'Invalid or expired token', success: false })
    }

    const clientId = process.env.FITBIT_CLIENT_ID || process.env.VITE_FITBIT_CLIENT_ID
    const redirectUri = process.env.FITBIT_REDIRECT_URI || process.env.VITE_FITBIT_REDIRECT_URI
    if (!clientId || !redirectUri) {
      return res.status(500).json({ message: 'Fitbit OAuth not configured', success: false })
    }

    const secret = process.env.OAUTH_STATE_SECRET
    const state = createSignedOAuthState({ userId: user.id, secret })

    const scopes = ['activity', 'heartrate', 'sleep', 'profile', 'settings'].join(' ')
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      expires_in: '604800'
    })

    const url = `https://www.fitbit.com/oauth2/authorize?${params.toString()}`
    return res.status(200).json({ success: true, url })
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Internal server error', success: false })
  }
}


