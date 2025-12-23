/**
 * Oura Token Refresh Handler
 * Refreshes Oura access token using refresh token
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  // Validate required OAuth credentials
  if (!process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET) {
    console.error('OAuth configuration error: Missing required credentials')
    return res.status(500).json({ success: false, error: { message: 'Server configuration error - OAuth not properly configured', status: 500 } })
  }

  try {
    // Auth required; derive userId from JWT (never trust body userId)
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization', status: 401 } })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ success: false, error: { message: 'Missing authorization token', status: 401 } })
    }

    // SECURITY: Only use service role key (no fallback to anon key)
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ success: false, error: { message: 'Server configuration error', status: 500 } })
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user?.id) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }
    const userId = user.id

    // Load refresh token from DB for this authenticated user
    const { data: account, error: acctErr } = await supabase
      .from('connected_accounts')
      .select('refresh_token')
      .eq('user_id', userId)
      .eq('provider', 'oura')
      .maybeSingle()

    if (acctErr) {
      return res.status(500).json({ success: false, error: { message: 'Database error', status: 500 }, details: acctErr.message })
    }
    if (!account?.refresh_token) {
      return res.status(400).json({ success: false, error: { message: 'No refresh token available. Please reconnect your Oura account.', status: 400 } })
    }

    // Exchange refresh token for new access token
    // Oura uses Basic Auth with client_id:client_secret
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
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Oura token refresh error:', errorData)
      return res.status(tokenResponse.status).json({
        success: false,
        error: { message: 'Failed to refresh token', status: tokenResponse.status },
        details: process.env.NODE_ENV === 'development' ? errorData : undefined
      })
    }

    const tokenData = await tokenResponse.json()

    // Calculate new expiration
    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 86400))

    const { error: dbError } = await supabase
      .from('connected_accounts')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || account.refresh_token, // Use new refresh token if provided
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('provider', 'oura')

    if (dbError) {
      console.error('Database error:', dbError)
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to update token', status: 500 },
        details: process.env.NODE_ENV === 'development' ? dbError : undefined
      })
    }

    return res.status(200).json({
      success: true,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || account.refresh_token,
      expires_at: expiresAt.toISOString(),
      token_type: tokenData.token_type || 'Bearer'
    })

  } catch (error) {
    console.error('Oura refresh error:', error)
    return res.status(500).json({
      success: false,
      error: { message: 'Internal server error', status: 500 },
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    })
  }
}

