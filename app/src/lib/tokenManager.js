/**
 * Token Manager
 * Handles automatic token refresh for connected accounts
 */

import { getConnectedAccount, saveConnectedAccount } from './wearables'
import { requireSupabase } from './supabase'
import { logError } from '../utils/logger'

/**
 * Check and refresh Fitbit token if needed
 * Called periodically to keep user logged in
 */
export async function checkAndRefreshFitbitToken(userId) {
  try {
    const supabase = requireSupabase()
    const account = await getConnectedAccount(userId, 'fitbit')
    
    if (!account) {
      return { needsRefresh: false, refreshed: false }
    }
    
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    
    // Refresh if expired or expires within 15 minutes
    if (!expiresAt || expiresAt <= new Date(now.getTime() + 15 * 60 * 1000)) {
      try {
        const response = await fetch('/api/fitbit/refresh', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token || ''}`
          },
          body: JSON.stringify({})
        })
        
        if (response.ok) {
          const tokenData = await response.json()
          
          // Update account with new tokens
          await saveConnectedAccount(userId, 'fitbit', {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: tokenData.expires_at,
            token_type: 'Bearer'
          })
          
          return { needsRefresh: true, refreshed: true }
        } else {
          const errorData = await response.json().catch(() => ({}))
          logError('Token refresh failed', errorData)
          
          // If refresh token is invalid, user needs to reconnect
          if (response.status === 401 || response.status === 403) {
            return { 
              needsRefresh: true, 
              refreshed: false, 
              error: 'Refresh token expired. Please reconnect your Fitbit account.',
              requiresReconnect: true
            }
          }
          
          return { needsRefresh: true, refreshed: false, error: 'Refresh failed' }
        }
      } catch (error) {
        logError('Error refreshing token', error)
        return { needsRefresh: true, refreshed: false, error: error.message }
      }
    }
    
    return { needsRefresh: false, refreshed: false }
  } catch (error) {
    logError('Error checking token', error)
    return { needsRefresh: false, refreshed: false, error: error.message }
  }
}

/**
 * Generic token refresh function for any provider
 */
export async function refreshTokenIfNeeded(userId, provider, account) {
  if (!account) return null
  const supabase = requireSupabase()
  
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null
  const now = new Date()
  
  // If token is still valid (more than 15 minutes until expiration), return as-is
  if (expiresAt && expiresAt > new Date(now.getTime() + 15 * 60 * 1000)) {
    return account
  }
  
  // Token needs refresh
  if (provider === 'fitbit') {
    try {
      const response = await fetch('/api/fitbit/refresh', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token || ''}`
        },
        body: JSON.stringify({})
      })
      
      if (response.ok) {
        const tokenData = await response.json()
        await saveConnectedAccount(userId, 'fitbit', {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: tokenData.expires_at,
          token_type: 'Bearer'
        })
        return { ...account, access_token: tokenData.access_token, expires_at: tokenData.expires_at }
      }
    } catch (error) {
      logError('Error refreshing Fitbit token', error)
      return account // Return original if refresh fails
    }
  } else if (provider === 'oura') {
    try {
      const response = await fetch('/api/oura/refresh', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token || ''}`
        },
        body: JSON.stringify({})
      })
      
      if (response.ok) {
        const tokenData = await response.json()
        await saveConnectedAccount(userId, 'oura', {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: tokenData.expires_at,
          token_type: 'Bearer'
        })
        return { ...account, access_token: tokenData.access_token, expires_at: tokenData.expires_at }
      }
    } catch (error) {
      logError('Error refreshing Oura token', error)
      return account // Return original if refresh fails
    }
  }
  
  return account
}

/**
 * Start automatic token refresh interval
 * Checks every 30 minutes
 */
export function startTokenRefreshInterval(userId) {
  // Check immediately
  checkAndRefreshFitbitToken(userId)
  
  // Then check every 30 minutes
  const interval = setInterval(() => {
    checkAndRefreshFitbitToken(userId)
  }, 30 * 60 * 1000) // 30 minutes
  
  return () => clearInterval(interval)
}

