/**
 * Fitbit OAuth Helper Functions
 */

import { getIdToken } from './cognitoAuth'
import { logDebug } from '../utils/logger'
import { apiUrl, getPublicSiteUrl } from './urlConfig'

// Get Fitbit config from environment
const FITBIT_CLIENT_ID = import.meta.env.VITE_FITBIT_CLIENT_ID || ''
const FITBIT_REDIRECT_URI = import.meta.env.VITE_FITBIT_REDIRECT_URI || 
  (typeof window !== 'undefined' ? `${getPublicSiteUrl()}/api/fitbit/callback` : '')

// Debug logging (only in development)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  logDebug('[Fitbit Auth] Client ID configured', { configured: Boolean(FITBIT_CLIENT_ID) })
  logDebug('[Fitbit Auth] Redirect URI', { redirectUri: FITBIT_REDIRECT_URI })
}

/**
 * Initiate Fitbit OAuth flow
 */
export function connectFitbit(userId: string) {
  if (import.meta.env.DEV) {
    logDebug('connectFitbit called', { hasUserId: Boolean(userId), clientConfigured: Boolean(FITBIT_CLIENT_ID) })
    logDebug('FITBIT_REDIRECT_URI', { redirectUri: FITBIT_REDIRECT_URI })
  }
  
  // SECURITY: generate signed OAuth state server-side (prevents CSRF / token write to wrong user).
  // `userId` param is kept for backward compatibility but not trusted.
  ;(async () => {
    const accessToken = await getIdToken()
    if (!accessToken) throw new Error('Authentication required')

    const resp = await fetch(apiUrl('/api/fitbit/start'), {
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

