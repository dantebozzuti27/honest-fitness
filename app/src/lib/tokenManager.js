/**
 * Token Manager
 * Handles automatic token refresh for connected accounts
 */

import { getConnectedAccount, saveConnectedAccount } from './wearables'

/**
 * Check and refresh Fitbit token if needed
 * Called periodically to keep user logged in
 */
export async function checkAndRefreshFitbitToken(userId) {
  try {
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            refreshToken: account.refresh_token
          })
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
          console.error('Token refresh failed:', await response.json().catch(() => ({})))
          return { needsRefresh: true, refreshed: false, error: 'Refresh failed' }
        }
      } catch (error) {
        console.error('Error refreshing token:', error)
        return { needsRefresh: true, refreshed: false, error: error.message }
      }
    }
    
    return { needsRefresh: false, refreshed: false }
  } catch (error) {
    console.error('Error checking token:', error)
    return { needsRefresh: false, refreshed: false, error: error.message }
  }
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

