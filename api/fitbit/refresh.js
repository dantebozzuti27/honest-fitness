/**
 * Fitbit Token Refresh Handler
 * Refreshes expired Fitbit access tokens
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
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
      .eq('provider', 'fitbit')
      .maybeSingle()

    if (acctErr) {
      return res.status(500).json({ success: false, error: { message: 'Database error', status: 500 }, details: acctErr.message })
    }
    if (!account?.refresh_token) {
      return res.status(400).json({ success: false, error: { message: 'No refresh token available. Please reconnect your Fitbit account.', status: 400 } })
    }

    // Refresh the token
    const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refresh_token
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      return res.status(401).json({
        success: false,
        error: { message: 'Failed to refresh token', status: 401 },
        details: process.env.NODE_ENV === 'development' ? errorData : undefined
      })
    }

    const tokenData = await tokenResponse.json()

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 28800))

    const { error: dbError } = await supabase
      .from('connected_accounts')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId)
      .eq('provider', 'fitbit')

    if (dbError) {
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to update tokens', status: 500 },
        details: process.env.NODE_ENV === 'development' ? dbError : undefined
      })
    }

    return res.status(200).json({
      success: true,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt.toISOString()
    })

  } catch (error) {
    console.error('Token refresh error:', error)
    return res.status(500).json({
      success: false,
      error: { message: 'Internal server error', status: 500 },
      details: process.env.NODE_ENV === 'development' ? error?.message : undefined
    })
  }
}

