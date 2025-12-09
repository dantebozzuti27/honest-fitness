/**
 * Fitbit OAuth Helper Functions
 */

// Get Fitbit config from environment
const FITBIT_CLIENT_ID = import.meta.env.VITE_FITBIT_CLIENT_ID || ''
const FITBIT_REDIRECT_URI = import.meta.env.VITE_FITBIT_REDIRECT_URI || 
  (typeof window !== 'undefined' ? `${window.location.origin}/api/fitbit/callback` : '')

// Debug logging (only in development)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.log('[Fitbit Auth] Client ID:', FITBIT_CLIENT_ID ? 'SET' : 'NOT SET')
  console.log('[Fitbit Auth] Redirect URI:', FITBIT_REDIRECT_URI)
}

/**
 * Get Fitbit OAuth authorization URL
 */
export function getFitbitAuthUrl(userId) {
  const scopes = [
    'activity',
    'heartrate',
    'sleep',
    'profile',
    'settings'
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
  if (import.meta.env.DEV) {
    console.log('connectFitbit called with userId:', userId)
    console.log('FITBIT_CLIENT_ID:', FITBIT_CLIENT_ID ? 'SET' : 'NOT SET')
    console.log('FITBIT_REDIRECT_URI:', FITBIT_REDIRECT_URI)
  }
  
  if (!FITBIT_CLIENT_ID) {
    const error = 'Fitbit Client ID not configured. Set VITE_FITBIT_CLIENT_ID in environment variables.'
    if (import.meta.env.DEV) console.error(error)
    throw new Error(error)
  }
  
  if (!userId) {
    const error = 'User ID is required to connect Fitbit'
    if (import.meta.env.DEV) console.error(error)
    throw new Error(error)
  }
  
  const authUrl = getFitbitAuthUrl(userId)
  if (import.meta.env.DEV) {
    // Debug logging only in development
    if (import.meta.env.DEV) {
      console.log('Redirecting to Fitbit OAuth:', authUrl)
    }
  }
  
  // Use window.location.assign for better error handling
  window.location.assign(authUrl)
}

/**
 * Check if Fitbit is connected
 */
export async function isFitbitConnected(userId) {
  const { getConnectedAccount } = await import('./wearables')
  const account = await getConnectedAccount(userId, 'fitbit')
  return !!account
}

