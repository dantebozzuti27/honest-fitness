/**
 * Fitbit Token Refresh Handler
 * Refreshes expired Fitbit access tokens
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { userId, refreshToken } = req.body

  if (!userId || !refreshToken) {
    return res.status(400).json({ message: 'Missing userId or refreshToken' })
  }

  try {
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
        refresh_token: refreshToken
      })
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      return res.status(401).json({ 
        message: 'Failed to refresh token',
        error: errorData 
      })
    }

    const tokenData = await tokenResponse.json()

    // Update tokens in Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
    )

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
        message: 'Failed to update tokens',
        error: dbError 
      })
    }

    return res.status(200).json({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt.toISOString()
    })

  } catch (error) {
    console.error('Token refresh error:', error)
    return res.status(500).json({ 
      message: 'Internal server error',
      error: error.message 
    })
  }
}

