/**
 * Fitbit OAuth Callback Handler
 * Handles the OAuth redirect from Fitbit after user authorization
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  // Handle error from Fitbit
  if (error) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent('No authorization code received')}`)
  }

  // Extract user ID from state (should be passed during OAuth initiation)
  const userId = state

  if (!userId) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid state parameter')}`)
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        client_id: process.env.FITBIT_CLIENT_ID,
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

    // Save tokens to Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials')
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Server configuration error')}`)
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Calculate token expiration
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 28800)) // Default 8 hours

    const { error: dbError } = await supabase
      .from('connected_accounts')
      .upsert({
        user_id: userId,
        provider: 'fitbit',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt.toISOString(),
        token_type: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' })

    if (dbError) {
      console.error('Database error:', dbError)
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Failed to save connection')}`)
    }

    // Success! Redirect back to app
    return res.redirect(`/?fitbit_connected=true`)

  } catch (error) {
    console.error('Fitbit callback error:', error)
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}

