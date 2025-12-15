/**
 * Oura Token Refresh Handler
 * Refreshes Oura access token using refresh token
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  // Validate required OAuth credentials
  if (!process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET) {
    console.error('OAuth configuration error: Missing required credentials')
    return res.status(500).json({ 
      message: 'Server configuration error - OAuth not properly configured' 
    })
  }

  try {
    // Auth required; derive userId from JWT (never trust body userId)
    const authHeader = req.headers?.authorization || req.headers?.Authorization
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Missing authorization' })
    }
    const token = authHeader.slice('Bearer '.length).trim()
    if (!token) {
      return res.status(401).json({ message: 'Missing authorization token' })
    }

    // SECURITY: Only use service role key (no fallback to anon key)
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ message: 'Server configuration error' })
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !user?.id) {
      return res.status(401).json({ message: 'Invalid or expired token' })
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
      return res.status(500).json({ message: 'Database error', error: acctErr.message })
    }
    if (!account?.refresh_token) {
      return res.status(400).json({ message: 'No refresh token available. Please reconnect your Oura account.' })
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
        message: 'Failed to refresh token',
        error: errorData 
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
        message: 'Failed to update token',
        error: dbError 
      })
    }

    return res.status(200).json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || account.refresh_token,
      expires_at: expiresAt.toISOString(),
      token_type: tokenData.token_type || 'Bearer'
    })

  } catch (error) {
    console.error('Oura refresh error:', error)
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message 
    })
  }
}

