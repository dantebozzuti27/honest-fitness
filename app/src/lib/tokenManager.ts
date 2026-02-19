/**
 * Token Manager + Fitbit Sync Scheduler
 * Handles token refresh and scheduled data syncs
 */

import { getConnectedAccount, saveConnectedAccount, getAllConnectedAccounts, syncFitbitData } from './wearables'
import { requireSupabase } from './supabase'
import { logError, logDebug } from '../utils/logger'
import { apiUrl } from './urlConfig'

/**
 * Check and refresh Fitbit token if needed
 * Called periodically to keep user logged in
 */
export async function checkAndRefreshFitbitToken(userId: string) {
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
        const response = await fetch(apiUrl('/api/fitbit/refresh'), {
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
      } catch (error: any) {
        logError('Error refreshing token', error)
        return { needsRefresh: true, refreshed: false, error: error?.message }
      }
    }
    
    return { needsRefresh: false, refreshed: false }
  } catch (error: any) {
    logError('Error checking token', error)
    return { needsRefresh: false, refreshed: false, error: error?.message }
  }
}

/**
 * Generic token refresh function for any provider
 */
export async function refreshTokenIfNeeded(userId: string, provider: string, account: any) {
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
      const response = await fetch(apiUrl('/api/fitbit/refresh'), {
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
    } catch (error: any) {
      logError('Error refreshing Fitbit token', error)
      return account // Return original if refresh fails
    }
  }
  
  return account
}

/**
 * Start automatic token refresh interval
 * Checks every 30 minutes
 */
export function startTokenRefreshInterval(userId: string) {
  checkAndRefreshFitbitToken(userId)
  
  const interval = setInterval(() => {
    checkAndRefreshFitbitToken(userId)
  }, 30 * 60 * 1000)
  
  return () => clearInterval(interval)
}

// ============ FITBIT SYNC SCHEDULER ============

function getETDate(offset = 0): string {
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const d = new Date(etStr)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMsUntilMidnightET(): number {
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etNow = new Date(etStr)
  const midnight = new Date(etStr)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)
  return Math.max(midnight.getTime() - etNow.getTime(), 60_000)
}

async function isFitbitConnected(userId: string): Promise<boolean> {
  try {
    const accounts = await getAllConnectedAccounts(userId)
    return accounts.some((a: any) => a.provider === 'fitbit')
  } catch { return false }
}

/**
 * Safe Fitbit sync — checks connection first, never throws.
 * Call this from workout start/end or anywhere you want a fire-and-forget sync.
 */
export async function triggerFitbitSync(userId: string, date?: string): Promise<void> {
  try {
    if (!(await isFitbitConnected(userId))) return
    await syncFitbitData(userId, date ?? getETDate(0))
    logDebug('Fitbit sync triggered', { date: date ?? getETDate(0) })
  } catch (err: any) {
    logError('triggerFitbitSync failed (non-fatal)', { message: err?.message })
  }
}

/**
 * Schedule Fitbit syncs:
 *   1. Immediately on app load (today)
 *   2. At midnight ET every night (syncs completed day + new day)
 * Returns cleanup function.
 */
export function startFitbitSyncScheduler(userId: string): () => void {
  let midnightTimeout: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  triggerFitbitSync(userId, getETDate(0))

  function scheduleMidnight() {
    if (cancelled) return
    const ms = getMsUntilMidnightET()
    logDebug('Fitbit midnight sync scheduled', { ms, minutesUntil: Math.round(ms / 60_000) })

    midnightTimeout = setTimeout(async () => {
      if (cancelled) return
      const yesterday = getETDate(-1)
      const today = getETDate(0)
      await triggerFitbitSync(userId, yesterday)
      await triggerFitbitSync(userId, today)
      scheduleMidnight()
    }, ms)
  }

  scheduleMidnight()

  return () => {
    cancelled = true
    if (midnightTimeout != null) clearTimeout(midnightTimeout)
  }
}

