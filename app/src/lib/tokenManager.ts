/**
 * Token Manager + Fitbit Sync Scheduler
 * Handles token refresh and scheduled data syncs
 */

import { getConnectedAccount, saveConnectedAccount, getAllConnectedAccounts, syncFitbitData } from './wearables'
import { requireSupabase } from './supabase'
import { logError, logDebug } from '../utils/logger'
import { apiUrl } from './urlConfig'

const SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000
const BACKFILL_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000
const syncInFlight = new Map<string, Promise<void>>()

function getSyncKey(userId: string, date: string): string {
  return `fitbit_sync_last_${userId}_${date}`
}

function readTs(key: string): number | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) ? ts : null
  } catch {
    return null
  }
}

function writeTs(key: string, ts: number): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, String(ts))
  } catch {
    // no-op
  }
}

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

function getLocalDateWithOffset(offset = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMsUntilLocalMidnight(): number {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setDate(midnight.getDate() + 1)
  midnight.setHours(0, 0, 0, 0)
  return Math.max(midnight.getTime() - now.getTime(), 60_000)
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
  const targetDate = date ?? getLocalDateWithOffset(0)
  const localKey = getSyncKey(userId, targetDate)
  const inflightKey = `${userId}:${targetDate}`
  const lastTs = readTs(localKey)
  if (lastTs != null && Date.now() - lastTs < SYNC_MIN_INTERVAL_MS) {
    return
  }
  if (syncInFlight.has(inflightKey)) {
    return syncInFlight.get(inflightKey)
  }

  const run = (async () => {
  try {
    if (!(await isFitbitConnected(userId))) return
    await syncFitbitData(userId, targetDate)
    writeTs(localKey, Date.now())
    logDebug('Fitbit sync triggered', { date: targetDate })
  } catch (err: any) {
    logError('triggerFitbitSync failed (non-fatal)', { message: err?.message })
  }
  })()

  syncInFlight.set(inflightKey, run)
  try {
    await run
  } finally {
    syncInFlight.delete(inflightKey)
  }
}

const BACKFILL_DAYS = 7
const BACKFILL_DELAY_MS = 300

function isLikelyInfraConnectivityError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror') ||
    m.includes('network request failed') ||
    m.includes('load failed') ||
    m.includes('ecconnrefused') ||
    m.includes('localhost:3001')
  )
}

/**
 * Backfill the last N days of Fitbit data.
 * Completed days (before today) get replaced with full 24-hour data,
 * fixing any partial snapshots that were saved mid-day.
 * Missing days get filled in entirely.
 */
async function backfillFitbitSync(userId: string, days: number = BACKFILL_DAYS): Promise<void> {
  if (!(await isFitbitConnected(userId))) return

  let warnedInfraFailure = false
  for (let offset = -(days - 1); offset <= 0; offset++) {
    const date = getLocalDateWithOffset(offset)
    try {
      await syncFitbitData(userId, date)
      logDebug('Fitbit backfill synced', { date })
    } catch (err: any) {
      const message = String(err?.message || '')
      if (isLikelyInfraConnectivityError(message)) {
        if (!warnedInfraFailure) {
          warnedInfraFailure = true
          logDebug('Fitbit backfill skipped: backend unavailable (non-fatal)', { message })
        }
        break
      }
      logError('Fitbit backfill failed for date (non-fatal)', { date, message })
    }
    if (offset < 0) {
      await new Promise(r => setTimeout(r, BACKFILL_DELAY_MS))
    }
  }
}

/**
 * Schedule Fitbit syncs:
 *   1. Immediately on app load — backfill the last 7 days to fix partial data
 *      and fill missed days, then sync today.
 *   2. At midnight ET every night (syncs completed day + new day).
 *   3. On foreground resume after >1h — sync yesterday (may have been partial)
 *      + today.
 * Returns cleanup function.
 */
export function startFitbitSyncScheduler(userId: string): () => void {
  let midnightTimeout: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const backfillKey = `fitbit_backfill_last_${userId}`
  const lastBackfillTs = readTs(backfillKey)
  if (lastBackfillTs == null || Date.now() - lastBackfillTs >= BACKFILL_MIN_INTERVAL_MS) {
    backfillFitbitSync(userId, BACKFILL_DAYS)
      .then(() => writeTs(backfillKey, Date.now()))
      .catch(() => {})
  } else {
    // Still ensure current day gets a sync when app starts.
    triggerFitbitSync(userId, getLocalDateWithOffset(0))
  }

  function scheduleMidnight() {
    if (cancelled) return
    const ms = getMsUntilLocalMidnight()
    logDebug('Fitbit midnight sync scheduled', { ms, minutesUntil: Math.round(ms / 60_000) })

    midnightTimeout = setTimeout(async () => {
      if (cancelled) return
      const yesterday = getLocalDateWithOffset(-1)
      const today = getLocalDateWithOffset(0)
      await triggerFitbitSync(userId, yesterday)
      await triggerFitbitSync(userId, today)
      scheduleMidnight()
    }, ms)
  }

  scheduleMidnight()

  let lastHiddenAt = 0
  const BACKGROUND_THRESHOLD_MS = 60 * 60 * 1000

  function onVisibilityChange() {
    if (cancelled) return
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now()
    } else if (document.visibilityState === 'visible' && lastHiddenAt > 0) {
      const elapsed = Date.now() - lastHiddenAt
      if (elapsed >= BACKGROUND_THRESHOLD_MS) {
        logDebug('App foregrounded after >1h background; syncing yesterday + today')
        triggerFitbitSync(userId, getLocalDateWithOffset(-1))
        triggerFitbitSync(userId, getLocalDateWithOffset(0))
      }
      lastHiddenAt = 0
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    cancelled = true
    if (midnightTimeout != null) clearTimeout(midnightTimeout)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

