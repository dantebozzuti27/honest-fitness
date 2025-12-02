/**
 * Fitbit OAuth Helper Functions
 */

const FITBIT_CLIENT_ID = import.meta.env.VITE_FITBIT_CLIENT_ID || ''
const FITBIT_REDIRECT_URI = import.meta.env.VITE_FITBIT_REDIRECT_URI || 
  `${window.location.origin}/api/fitbit/callback`

/**
 * Get Fitbit OAuth authorization URL
 */
export function getFitbitAuthUrl(userId) {
  const scopes = [
    'activity',
    'heartrate',
    'sleep',
    'profile'
  ].join(' ')
  
  const params = new URLSearchParams({
    client_id: FITBIT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: FITBIT_REDIRECT_URI,
    scope: scopes,
    state: userId, // Pass user ID in state for security
    expires_in: '604800' // 7 days
  })
  
  return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`
}

/**
 * Initiate Fitbit OAuth flow
 */
export function connectFitbit(userId) {
  if (!FITBIT_CLIENT_ID) {
    throw new Error('Fitbit Client ID not configured. Set VITE_FITBIT_CLIENT_ID in environment variables.')
  }
  
  const authUrl = getFitbitAuthUrl(userId)
  window.location.href = authUrl
}

/**
 * Check if Fitbit is connected
 */
export async function isFitbitConnected(userId) {
  const { getConnectedAccount } = await import('./wearables')
  const account = await getConnectedAccount(userId, 'fitbit')
  return !!account
}

