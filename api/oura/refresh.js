import { extractUser } from '../_shared/auth.js'
import { query } from '../_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed', status: 405 } })
  }

  if (!process.env.OURA_CLIENT_ID || !process.env.OURA_CLIENT_SECRET) {
    console.error('OAuth configuration error: Missing required credentials')
    return res.status(500).json({ success: false, error: { message: 'Server configuration error - OAuth not properly configured', status: 500 } })
  }

  try {
    const user = extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or expired token', status: 401 } })
    }
    const userId = user.id

    const { rows } = await query(
      `SELECT refresh_token FROM connected_accounts WHERE user_id = $1 AND provider = $2`,
      [userId, 'oura']
    )
    const account = rows[0] || null

    if (!account?.refresh_token) {
      return res.status(400).json({ success: false, error: { message: 'No refresh token available. Please reconnect your Oura account.', status: 400 } })
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

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 86400))

    try {
      await query(
        `UPDATE connected_accounts
         SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
         WHERE user_id = $5 AND provider = $6`,
        [
          tokenData.access_token,
          tokenData.refresh_token || account.refresh_token,
          expiresAt.toISOString(),
          new Date().toISOString(),
          userId,
          'oura'
        ]
      )
    } catch (dbError) {
      console.error('Database error:', dbError)
      return res.status(500).json({
        success: false,
        error: { message: 'Failed to update token', status: 500 },
        details: process.env.NODE_ENV === 'development' ? dbError.message : undefined
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
