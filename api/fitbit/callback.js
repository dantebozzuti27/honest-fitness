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
  // State parameter is critical for CSRF protection (OAuth 2.0 security requirement)
  const userId = state

  if (!userId) {
    console.error('OAuth security violation: Missing state parameter')
    return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid state parameter - security validation failed')}`)
  }

  // Validate state parameter format (should be UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(userId)) {
    console.error('OAuth security violation: Invalid state format')
    return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid state format - security validation failed')}`)
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
    // SECURITY: Only use service role key (no fallback to anon key)
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
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
      console.error('Error details:', JSON.stringify(dbError, null, 2))
      return res.redirect(`/?fitbit_error=${encodeURIComponent(`Failed to save connection: ${dbError.message || 'Database error'}`)}`)
    }

    // Success! Redirect to Wearables page
    return res.redirect(`/wearables?fitbit_connected=true`)

  } catch (error) {
    console.error('Fitbit callback error:', error)
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}

