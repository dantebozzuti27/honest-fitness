import { query } from '../../../api/_shared/db.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { code, error, state } = req.query

  if (error) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent('No authorization code received')}`)
  }

  const userId = state

  if (!userId) {
    return res.redirect(`/?fitbit_error=${encodeURIComponent('Invalid state parameter')}`)
  }

  try {
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

    const expiresAt = new Date()
    expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in || 28800))

    try {
      await query(
        `INSERT INTO connected_accounts (user_id, provider, access_token, refresh_token, expires_at, token_type, scope, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           token_type = EXCLUDED.token_type,
           scope = EXCLUDED.scope,
           updated_at = EXCLUDED.updated_at`,
        [userId, 'fitbit', tokenData.access_token, tokenData.refresh_token,
         expiresAt.toISOString(), tokenData.token_type || 'Bearer',
         tokenData.scope || null, new Date().toISOString()]
      )
    } catch (dbError) {
      console.error('Database error:', dbError)
      return res.redirect(`/?fitbit_error=${encodeURIComponent('Failed to save connection')}`)
    }

    return res.redirect(`/?fitbit_connected=true`)

  } catch (error) {
    console.error('Fitbit callback error:', error)
    return res.redirect(`/?fitbit_error=${encodeURIComponent(error.message || 'Unknown error')}`)
  }
}
