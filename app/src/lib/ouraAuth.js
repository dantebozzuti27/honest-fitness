/**
 * Oura OAuth Helper Functions
 */

import { getConnectedAccount } from './wearables'
import { requireSupabase } from './supabase'
import { logDebug } from '../utils/logger'
import { apiUrl, getPublicSiteUrl } from './urlConfig'

// Get Oura config from environment
const OURA_CLIENT_ID = import.meta.env.VITE_OURA_CLIENT_ID || ''
const OURA_REDIRECT_URI = import.meta.env.VITE_OURA_REDIRECT_URI || 
  (typeof window !== 'undefined' ? `${getPublicSiteUrl()}/api/oura/callback` : '')

// Debug logging (only in development)
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  logDebug('[Oura Auth] Client ID configured', { configured: Boolean(OURA_CLIENT_ID) })
  logDebug('[Oura Auth] Redirect URI', { redirectUri: OURA_REDIRECT_URI })
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
    logDebug('connectOura called', { hasUserId: Boolean(userId), clientConfigured: Boolean(OURA_CLIENT_ID) })
    logDebug('OURA_REDIRECT_URI', { redirectUri: OURA_REDIRECT_URI })
  }
  
  // SECURITY: generate signed OAuth state server-side (prevents CSRF / token write to wrong user).
  // `userId` param is kept for backward compatibility but not trusted.
  ;(async () => {
    const supabase = requireSupabase()
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) throw error
    const accessToken = session?.access_token
    if (!accessToken) throw new Error('Authentication required')

    const resp = await fetch(apiUrl('/api/oura/start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({})
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || !data?.url) {
      throw new Error(data?.message || 'Failed to start Oura OAuth. Please try again.')
    }
    if (import.meta.env.DEV) logDebug('Redirecting to Oura OAuth (server-signed state)', { url: data.url })
    window.location.assign(data.url)
  })().catch((e) => {
    setTimeout(() => {
      throw e
    }, 0)
  })
}

/**
 * Check if Oura is connected
 */
export async function isOuraConnected(userId) {
  const account = await getConnectedAccount(userId, 'oura')
  return !!account
}

