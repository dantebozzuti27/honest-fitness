import { supabase as supabaseClient, requireSupabase, supabaseConfigErrorMessage } from './supabase'
import { getTodayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug } from '../utils/logger'
import { checkRateLimit, getRemainingRequests } from './rateLimiter'
import { apiUrl } from './urlConfig'
import { trackEvent } from '../utils/analytics'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

// Avoid TypeError crashes when Supabase env is missing; throw a clear message at call time instead.
const supabase: any = supabaseClient ?? new Proxy({}, { get: () => { throw new Error(supabaseConfigErrorMessage) } })

/**
 * Wearables OAuth and Data Sync
 * Supports: Fitbit
 */

// ============ CONNECTED ACCOUNTS ============

export async function saveConnectedAccount(userId: string, provider: string, tokens: any) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('connected_accounts')
    .upsert({
      user_id: userId,
      provider: provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expires_at: tokens.expires_at ? new Date(tokens.expires_at).toISOString() : null,
      token_type: tokens.token_type || 'Bearer',
      scope: tokens.scope || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,provider' })
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function getConnectedAccount(userId: string, provider: string) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getAllConnectedAccounts(userId: string) {
  const client = requireSupabase()
  const { data, error } = await client
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
  
  if (error) throw error
  return data || []
}

export async function disconnectAccount(userId: string, provider: string) {
  const client = requireSupabase()
  const { error } = await client
    .from('connected_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
  
  if (error) throw error
}

// ============ FITBIT INTEGRATION ============

export async function saveFitbitDaily(userId: string, date: string, data: any) {
  // Save to health_metrics table (unified table)
  const healthMetricsData = {
    user_id: userId,
    date: date,
    resting_heart_rate: toNumber(data.resting_heart_rate),
    hrv: toNumber(data.hrv),
    body_temp: toNumber(data.body_temp),
    sleep_duration: toNumber(data.sleep_duration),
    calories_burned: toNumber(data.calories),
    steps: toInteger(data.steps), // INTEGER column - must be whole number
    hr_zones_minutes: data.hr_zones_minutes || null,
    max_heart_rate: toNumber(data.max_heart_rate),
    source_provider: 'fitbit',
    source_data: {
      sleep_efficiency: toNumber(data.sleep_efficiency),
      active_calories: toNumber(data.active_calories),
      distance: toNumber(data.distance),
      floors: data.floors || null,
      average_heart_rate: toNumber(data.average_heart_rate),
      sedentary_minutes: data.sedentary_minutes || null,
      lightly_active_minutes: data.lightly_active_minutes || null,
      fairly_active_minutes: data.fairly_active_minutes || null,
      very_active_minutes: data.very_active_minutes || null,
      marginal_calories: toNumber(data.marginal_calories),
      weight: toNumber(data.weight),
      bmi: toNumber(data.bmi),
      fat: toNumber(data.fat)
    },
    updated_at: new Date().toISOString()
  }

  // Strip null/undefined top-level values to avoid overwriting manually entered data
  const keepKeys = new Set(['user_id', 'date', 'source_provider', 'updated_at', 'source_data', 'hr_zones_minutes'])
  for (const key of Object.keys(healthMetricsData)) {
    if (!keepKeys.has(key) && ((healthMetricsData as Record<string, unknown>)[key] === null || (healthMetricsData as Record<string, unknown>)[key] === undefined)) {
      delete (healthMetricsData as Record<string, unknown>)[key]
    }
  }

  const { data: result, error } = await supabase
    .from('health_metrics')
    .upsert(healthMetricsData, { onConflict: 'user_id,date' })
    .select()
    .maybeSingle()
  
  if (error) {
      logError('Error saving Fitbit daily data to health_metrics', error)
    throw error
  }
  
  // Also save to fitbit_daily for backward compatibility (deprecated but kept)
  try {
    await supabase
      .from('fitbit_daily')
      .upsert({
        user_id: userId,
        date: date,
        hrv: toNumber(data.hrv),
        resting_heart_rate: toNumber(data.resting_heart_rate),
        sleep_duration: toNumber(data.sleep_duration),
        sleep_efficiency: toNumber(data.sleep_efficiency),
        calories: toNumber(data.calories),
        steps: toInteger(data.steps),
        active_calories: toNumber(data.active_calories),
        distance: toNumber(data.distance),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
  } catch (err) {
    // Ignore errors on deprecated table
    safeLogDebug('Error saving to fitbit_daily (deprecated)', err)
  }
  
  return result
}

export async function getFitbitDaily(userId: string, date: string) {
  // Get from health_metrics (primary source)
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('source_provider', 'fitbit')
    .maybeSingle()
  
  if (error) {
      logError('Error getting Fitbit daily data from health_metrics', error)
    // Try deprecated table as fallback
    const { data: legacyData, error: legacyError } = await supabase
      .from('fitbit_daily')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()
    
    if (legacyError) {
      logError('Error getting Fitbit daily data from fitbit_daily', legacyError)
      return null
    }
    return legacyData
  }
  
  return data
}

/**
 * Get most recent Fitbit data
 */
export async function getMostRecentFitbitData(userId: string) {
  // Get from health_metrics (primary source)
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('source_provider', 'fitbit')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  if (error) {
    logError('Error getting most recent Fitbit data from health_metrics', error)
    // Try deprecated table as fallback
    const { data: legacyData, error: legacyError } = await supabase
      .from('fitbit_daily')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
    
    if (legacyError) {
      logError('Error getting most recent Fitbit data from fitbit_daily', legacyError)
      return null
    }
    return legacyData
  }
  
  return data
}

/**
 * Refresh Fitbit access token if expired
 */
async function refreshFitbitToken(userId: string, account: any) {
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null
  const now = new Date()
  
  // Refresh if expired or expires within 5 minutes
  if (!expiresAt || expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
    try {
      const response = await fetch(apiUrl('/api/fitbit/refresh'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession())?.data?.session?.access_token || ''}`
        },
        body: JSON.stringify({})
      })
      
      if (!response.ok) {
        throw new Error('Failed to refresh token')
      }
      
      const tokenData = await response.json()
      
      // Update account with new tokens
      await saveConnectedAccount(userId, 'fitbit', {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: tokenData.expires_at,
        token_type: 'Bearer'
      })
      
      return tokenData.access_token
  } catch (error: any) {
      logError('Error refreshing Fitbit token', error)
      throw new Error('Token refresh failed. Please reconnect your Fitbit account.')
    }
  }
  
  return account.access_token
}

/**
 * Sync Fitbit data for a date
 * Uses serverless function to avoid CORS issues
 */
export async function syncFitbitData(userId: string, date: string | null = null) {
  const targetDate = date || getTodayEST()
  
  // Rate limiting: max 10 syncs per minute per user
  const rateLimitKey = `fitbit_sync_${userId}`
  if (!checkRateLimit(rateLimitKey, 'sync')) {
    const remaining = getRemainingRequests(rateLimitKey, 'sync')
    throw new Error(`Rate limit exceeded. Please wait before syncing again. (${remaining} requests remaining)`)
  }

  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token || ''
    
    // Use serverless function to sync Fitbit data
    const response = await fetch(apiUrl('/api/fitbit/sync'), {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        date: targetDate
      })
    })
    
    if (!response.ok) {
      let errorData: any = {}
      try {
        errorData = await response.json()
      } catch (e) {
        // If response isn't JSON, use status text
        errorData = { error: response.statusText || 'Unknown error' }
      }
      
      const errorMessage = (errorData.error || errorData.message || `HTTP ${response.status}: Failed to sync Fitbit data`).toString()
      
      // Check for specific error types
      if (response.status === 401 || (typeof errorMessage === 'string' && (errorMessage.includes('authorization') || errorMessage.includes('reconnect')))) {
        throw new Error('Fitbit authorization expired. Please reconnect your account from the Wearables page.')
      }
      
      if (response.status === 404 && typeof errorMessage === 'string' && errorMessage.includes('not connected')) {
        throw new Error('Fitbit account not found. Please connect your Fitbit account first.')
      }
      
      // For 500 errors, provide more helpful message
      if (response.status === 500) {
        throw new Error('Fitbit sync service error. Please try again later or reconnect your account.')
      }
      
      throw new Error(errorMessage)
    }
    
    const result: any = await response.json()
    
    // Check if sync was successful
    if (!result.success) {
      throw new Error(result.error || 'Sync failed')
    }
    
    // Also save directly to fitbit_daily table
    if (result.data) {
      await saveFitbitDaily(userId, targetDate, result.data)
      // Merge into daily_metrics
      await mergeWearableDataToMetrics(userId, targetDate)
    }
    
    trackEvent('fitbit_sync', { date: targetDate, hasData: !!result.data })

    return {
      synced: true,
      date: targetDate,
      data: result.data || result,
      warnings: result.warnings
    }
    
  } catch (error: any) {
    // Re-throw with better message
    const errorMsg = typeof error?.message === 'string' ? error.message : String(error || 'Unknown error')
    if (errorMsg.includes('authorization') || errorMsg.includes('reconnect')) {
      throw error // Already has good message
    }
    
    throw new Error(`Failed to sync Fitbit data: ${errorMsg}`)
  }
}

// ============ UNIFIED MERGE ============

/**
 * Merge Fitbit data into health_metrics table
 */
export async function mergeWearableDataToMetrics(userId: string, date: string | null = null) {
  const targetDate = date || getTodayEST()
  
  const { data: existingMetrics } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', targetDate)
    .maybeSingle()
  
  const fitbitData = await getFitbitDaily(userId, targetDate)
  
  const sd = fitbitData?.source_data || {} as Record<string, any>

  const merged: Record<string, any> = {
    user_id: userId,
    date: targetDate,
    resting_heart_rate: toNumber(fitbitData?.resting_heart_rate) ?? existingMetrics?.resting_heart_rate ?? null,
    hrv: toNumber(fitbitData?.hrv) ?? existingMetrics?.hrv ?? null,
    body_temp: toNumber(fitbitData?.body_temp) ?? existingMetrics?.body_temp ?? null,
    sleep_score: (() => {
      const eff = sd.sleep_efficiency != null ? toNumber(sd.sleep_efficiency) : null
      if (eff != null) return Math.round(eff)
      return existingMetrics?.sleep_score ?? null
    })(),
    sleep_duration: toNumber(fitbitData?.sleep_duration) ?? existingMetrics?.sleep_duration ?? null,
    deep_sleep: toNumber(sd.deep_sleep) ?? existingMetrics?.deep_sleep ?? null,
    rem_sleep: toNumber(sd.rem_sleep) ?? existingMetrics?.rem_sleep ?? null,
    light_sleep: toNumber(sd.light_sleep) ?? existingMetrics?.light_sleep ?? null,
    calories_burned: toNumber(fitbitData?.calories_burned) ?? existingMetrics?.calories_burned ?? null,
    steps: toInteger(fitbitData?.steps) ?? existingMetrics?.steps ?? null,
    hr_zones_minutes: fitbitData?.hr_zones_minutes ?? existingMetrics?.hr_zones_minutes ?? null,
    max_heart_rate: toNumber(fitbitData?.max_heart_rate) ?? existingMetrics?.max_heart_rate ?? null,
    average_heart_rate: toNumber(sd.average_heart_rate) ?? existingMetrics?.average_heart_rate ?? null,
    active_minutes_fairly: toInteger(sd.fairly_active_minutes) ?? existingMetrics?.active_minutes_fairly ?? null,
    active_minutes_very: toInteger(sd.very_active_minutes) ?? existingMetrics?.active_minutes_very ?? null,
    active_minutes_lightly: toInteger(sd.lightly_active_minutes) ?? existingMetrics?.active_minutes_lightly ?? null,
    sedentary_minutes: toInteger(sd.sedentary_minutes) ?? existingMetrics?.sedentary_minutes ?? null,
    floors: toInteger(sd.floors) ?? existingMetrics?.floors ?? null,
    distance: toNumber(sd.distance) ?? existingMetrics?.distance ?? null,
    weight: existingMetrics?.weight ?? toNumber(sd.weight) ?? null,
    body_fat_percentage: existingMetrics?.body_fat_percentage ?? toNumber(sd.fat) ?? null,
    source_provider: fitbitData ? 'fitbit' : existingMetrics?.source_provider ?? 'manual',
    source_data: {
      ...(sd),
      ...(existingMetrics?.source_data || {})
    },
    updated_at: new Date().toISOString()
  }

  // Strip null top-level values to avoid creating columns that don't exist yet
  for (const key of Object.keys(merged)) {
    if (merged[key] === null && key !== 'user_id' && key !== 'date' && key !== 'source_provider' && key !== 'updated_at' && key !== 'source_data') {
      delete merged[key]
    }
  }
  
  if (merged.hrv || merged.sleep_duration || merged.steps || merged.calories_burned || merged.resting_heart_rate) {
    const { data, error } = await supabase
      .from('health_metrics')
      .upsert(merged, { onConflict: 'user_id,date' })
      .select()
      .single()
    
    if (error) {
      logError('Error merging wearable data to health_metrics', error)
      throw error
    }
    
    return data
  }
  
  return existingMetrics || merged
}

