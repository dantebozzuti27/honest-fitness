/**
 * Fitbit OAuth Helper Functions
 */

import { getConnectedAccount } from './wearables'
import { requireSupabase } from './supabase'
import { logDebug } from '../utils/logger'

// Get Fitbit config from environment
const FITBIT_CLIENT_ID = import.meta.env.VITE_FITBIT_CLIENT_ID || ''
const FITBIT_REDIRECT_URI = import.meta.env.VITE_FITBIT_REDIRECT_URI || 
  (typeof window !== 'undefined' ? `${window.location.origin}/api/fitbit/callback` : '')

// Debug logging (only in development)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  logDebug('[Fitbit Auth] Client ID configured', { configured: Boolean(FITBIT_CLIENT_ID) })
  logDebug('[Fitbit Auth] Redirect URI', { redirectUri: FITBIT_REDIRECT_URI })
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
    logDebug('connectFitbit called', { hasUserId: Boolean(userId), clientConfigured: Boolean(FITBIT_CLIENT_ID) })
    logDebug('FITBIT_REDIRECT_URI', { redirectUri: FITBIT_REDIRECT_URI })
  }
  
  // SECURITY: generate signed OAuth state server-side (prevents CSRF / token write to wrong user).
  // `userId` param is kept for backward compatibility but not trusted.
  ;(async () => {
    const supabase = requireSupabase()
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    const accessToken = session?.access_token
    if (!accessToken) throw new Error('Authentication required')

    const resp = await fetch('/api/fitbit/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({})
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data?.url) {
      throw new Error(data?.message || 'Failed to start Fitbit OAuth. Please try again.')
    }
    if (import.meta.env.DEV) logDebug('Redirecting to Fitbit OAuth (server-signed state)', { url: data.url })
    window.location.assign(data.url)
  })().catch((e) => {
    // Re-throw asynchronously so callers can still surface an error toast.
    setTimeout(() => {
      throw e
    }, 0)
  })
}

/**
 * Check if Fitbit is connected
 */
export async function isFitbitConnected(userId) {
  const account = await getConnectedAccount(userId, 'fitbit')
  return !!account
}

