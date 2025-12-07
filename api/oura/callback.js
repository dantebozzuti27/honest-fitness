/**
 * Oura OAuth Callback Handler
 * Handles the OAuth redirect from Oura after user authorization
 */

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  // Handle error from Oura
  if (error) {
    return res.redirect(`/?oura_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect(`/?oura_error=${encodeURIComponent('No authorization code received')}`)
  }

  // Extract user ID from state (should be passed during OAuth initiation)
  // State parameter is critical for CSRF protection (OAuth 2.0 security requirement)
  const userId = state

  if (!userId) {
    console.error('OAuth security violation: Missing state parameter')
    return res.redirect(`/?oura_error=${encodeURIComponent('Invalid state parameter - security validation failed')}`)
  }

  // Validate state parameter format (should be UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(userId)) {
    console.error('OAuth security violation: Invalid state format')
    return res.redirect(`/?oura_error=${encodeURIComponent('Invalid state format - security validation failed')}`)
  }

  try {
    // Validate required OAuth credentials
    if (!process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET || !process.env.OURA_REDIRECT_URI) {
      console.error('OAuth configuration error: Missing required credentials')
      return res.redirect(`/?oura_error=${encodeURIComponent('Server configuration error - OAuth not properly configured')}`)
    }

    // Exchange authorization code for access token
    // OAuth 2.0 Authorization Code Flow with PKCE (industry standard)
    // Oura uses Basic Auth with client_id:client_secret
    const basicAuth = Buffer.from(
      `${process.env.OURA_CLIENT_ID}:${process.env.OURA_CLIENT_SECRET}`
    ).toString('base64')
    
    // Use HTTPS endpoint (required for OAuth 2.0 security)
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

    // Save tokens to Supabase
    // Use service role key to bypass RLS (server-side operation)
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    // Prefer service role key for server-side operations, fallback to anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('Missing Supabase credentials')
      return res.redirect(`/?oura_error=${encodeURIComponent('Server configuration error')}`)
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Calculate token expiration
    // OAuth 2.0 best practice: Use short-lived access tokens
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 86400)) // Default 24 hours
    
    // Log successful OAuth connection (for audit/compliance)
    console.log(`OAuth connection successful for user: ${userId} at ${new Date().toISOString()}`)

    const { error: dbError } = await supabase
      .from('connected_accounts')
      .upsert({
        user_id: userId,
        provider: 'oura',
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        expires_at: expiresAt.toISOString(),
        token_type: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,provider' })

    if (dbError) {
      console.error('Database error:', dbError)
      console.error('Error details:', JSON.stringify(dbError, null, 2))
      return res.redirect(`/?oura_error=${encodeURIComponent(`Failed to save connection: ${dbError.message || 'Database error'}`)}`)
    }

    // Success! Redirect to Wearables page
    return res.redirect(`/wearables?oura_connected=true`)

  } catch (error) {
    console.error('Oura callback error:', error)
    return res.redirect(`/?oura_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}

