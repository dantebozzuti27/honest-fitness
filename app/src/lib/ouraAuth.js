/**
 * Oura OAuth Helper Functions
 */

// Get Oura config from environment
const OURA_CLIENT_ID = import.meta.env.VITE_OURA_CLIENT_ID || ''
const OURA_REDIRECT_URI = import.meta.env.VITE_OURA_REDIRECT_URI || 
  (typeof window !== 'undefined' ? `${window.location.origin}/api/oura/callback` : '')

// Debug logging (only in development)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  console.log('[Oura Auth] Client ID:', OURA_CLIENT_ID ? 'SET' : 'NOT SET')
  console.log('[Oura Auth] Redirect URI:', OURA_REDIRECT_URI)
}

/**
 * Get Oura OAuth authorization URL
 * Oura uses OAuth 2.0 with specific scopes
 */
export function getOuraAuthUrl(userId) {
  if (!OURA_CLIENT_ID) {
    throw new Error('Oura OAuth is not configured. Please set VITE_OURA_CLIENT_ID environment variable.')
  }
  
  // Oura API scopes: personal (read personal info), daily (read daily data), session (read session data)
  const scopes = 'personal daily session'
  
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OURA_CLIENT_ID,
    redirect_uri: OURA_REDIRECT_URI,
    scope: scopes,
    state: userId // Pass user ID in state for security
  })
  
  return `https://cloud.ouraring.com/oauth/authorize?${params.toString()}`
}

/**
 * Initiate Oura OAuth flow
 */
export function connectOura(userId) {
  if (import.meta.env.DEV) {
    console.log('connectOura called with userId:', userId)
    console.log('OURA_CLIENT_ID:', OURA_CLIENT_ID ? 'SET' : 'NOT SET')
    console.log('OURA_REDIRECT_URI:', OURA_REDIRECT_URI)
  }
  
  if (!OURA_CLIENT_ID) {
    const error = 'Oura Client ID not configured. Set VITE_OURA_CLIENT_ID in environment variables.'
    if (import.meta.env.DEV) console.error(error)
    throw new Error(error)
  }
  
  if (!userId) {
    const error = 'User ID is required to connect Oura'
    if (import.meta.env.DEV) console.error(error)
    throw new Error(error)
  }
  
  const authUrl = getOuraAuthUrl(userId)
  if (import.meta.env.DEV) {
    console.log('Redirecting to Oura OAuth:', authUrl)
  }
  
  // Use window.location.assign for better error handling
  window.location.assign(authUrl)
}

/**
 * Check if Oura is connected
 */
export async function isOuraConnected(userId) {
  const { getConnectedAccount } = await import('./wearables')
  const account = await getConnectedAccount(userId, 'oura')
  return !!account
}

