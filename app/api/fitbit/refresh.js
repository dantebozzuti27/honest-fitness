import { extractUser } from '../../../api/_shared/auth.js'
import { query } from '../../../api/_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  try {
    const user = await extractUser(req)
    if (!user) {
      return res.status(401).json({ success: false, error: { message: 'Missing or invalid authorization', status: 401 } })
    }
    const userId = user.id

    const { rows } = await query(
      'SELECT refresh_token FROM connected_accounts WHERE user_id = $1 AND provider = $2',
      [userId, 'fitbit']
    )
    const account = rows[0]

    if (!account?.refresh_token) {
      return res.status(400).json({ success: false, error: { message: 'No refresh token available. Please reconnect your Fitbit account.', status: 400 } })
    }

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

    await query(
      `UPDATE connected_accounts
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = $4
       WHERE user_id = $5 AND provider = $6`,
      [tokenData.access_token, tokenData.refresh_token, expiresAt.toISOString(),
       new Date().toISOString(), userId, 'fitbit']
    )

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
