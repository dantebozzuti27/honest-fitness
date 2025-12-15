/**
 * Fitbit OAuth Helper Functions
 */

import { getConnectedAccount } from './wearables'
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
  
  if (!FITBIT_CLIENT_ID) {
    const error = 'Fitbit Client ID not configured. Set VITE_FITBIT_CLIENT_ID in environment variables.'
    if (import.meta.env.DEV) logDebug('Fitbit config error', { message: error })
    throw new Error(error)
  }
  
  if (!userId) {
    const error = 'User ID is required to connect Fitbit'
    if (import.meta.env.DEV) logDebug('Fitbit connect error', { message: error })
    throw new Error(error)
  }
  
  const authUrl = getFitbitAuthUrl(userId)
  if (import.meta.env.DEV) logDebug('Redirecting to Fitbit OAuth', { authUrl })
  
  // Use window.location.assign for better error handling
  window.location.assign(authUrl)
}

/**
 * Check if Fitbit is connected
 */
export async function isFitbitConnected(userId) {
  const account = await getConnectedAccount(userId, 'fitbit')
  return !!account
}

