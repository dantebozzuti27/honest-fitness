import { supabase as supabaseClient, requireSupabase, supabaseConfigErrorMessage } from './supabase'
import { getTodayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug } from '../utils/logger'
import { checkRateLimit, getRemainingRequests } from './rateLimiter'
import { apiUrl } from './urlConfig'

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

// Legacy function - kept for backwards compatibility but now uses serverless function
async function syncFitbitDataDirect(userId: string, date: string | null = null) {
  const targetDate = date || getTodayEST()
  const account = await getConnectedAccount(userId, 'fitbit')
  
  if (!account) {
    throw new Error('Fitbit account not connected')
  }
  
  // Refresh token if needed
  const accessToken = await refreshFitbitToken(userId, account)
  
  try {
    // Fetch sleep data
    const sleepResponse = await fetch(
      `https://api.fitbit.com/1.2/user/-/sleep/date/${targetDate}.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    let sleepData = null
    if (sleepResponse.ok) {
      const sleepJson = await sleepResponse.json()
      if (sleepJson.sleep && sleepJson.sleep.length > 0) {
        const sleep = sleepJson.sleep[0]
        sleepData = {
          sleep_duration: sleep.minutesAsleep || null,
          sleep_efficiency: sleep.efficiency || null
        }
      }
    }
    
    // Fetch heart rate data (for resting heart rate and HRV)
    const hrResponse = await fetch(
      `https://api.fitbit.com/1/user/-/activities/heart/date/${targetDate}/1d.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    let hrData = null
    if (hrResponse.ok) {
      const hrJson = await hrResponse.json()
      if (hrJson['activities-heart'] && hrJson['activities-heart'].length > 0) {
        const heartData = hrJson['activities-heart'][0].value
        hrData = {
          resting_heart_rate: heartData?.restingHeartRate || null
        }
      }
    }
    
    // Fetch HRV data (Heart Rate Variability)
    // HRV is typically available in the heart rate intraday data or sleep data
    let hrvData = null
    try {
      // Try to get HRV from heart rate intraday endpoint
      const hrvResponse = await fetch(
        `https://api.fitbit.com/1/user/-/hrv/date/${targetDate}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrvResponse.ok) {
        const hrvJson = await hrvResponse.json()
        // Fitbit HRV endpoint returns data in different formats
        // Check for daily summary or intraday data
        if (hrvJson.hrv && hrvJson.hrv.length > 0) {
          // Get average HRV for the day
          const hrvValues = hrvJson.hrv
            .map((entry: any) => entry.value?.dailyRmssd || entry.value?.rmssd)
            .filter((v: any) => v != null)
          
          if (hrvValues.length > 0) {
            const avgHRV = hrvValues.reduce((a: number, b: number) => a + b, 0) / hrvValues.length
            hrvData = { hrv: avgHRV }
          }
        }
      }
    } catch (hrvError) {
      // HRV endpoint might not be available for all devices
      safeLogDebug('HRV data not available', hrvError)
    }
    
    // Also check sleep data for HRV (some Fitbit devices include HRV in sleep)
    if (!hrvData && sleepData) {
      try {
        const sleepDetailResponse = await fetch(
          `https://api.fitbit.com/1.2/user/-/sleep/date/${targetDate}.json`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`
            }
          }
        )
        
        if (sleepDetailResponse.ok) {
          const sleepDetailJson = await sleepDetailResponse.json()
          if (sleepDetailJson.sleep && sleepDetailJson.sleep.length > 0) {
            const sleep = sleepDetailJson.sleep[0]
            // Some Fitbit devices include HRV in sleep data
            if (sleep.levels?.summary?.rem?.hrv) {
              hrvData = { hrv: sleep.levels.summary.rem.hrv }
            }
          }
        }
      } catch (sleepHrvError) {
        // Continue if HRV not in sleep data
      }
    }
    
    // Fetch activity summary
    const activityResponse = await fetch(
      `https://api.fitbit.com/1/user/-/activities/date/${targetDate}.json`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    )
    
    let activityData = null
    if (activityResponse.ok) {
      const activityJson = await activityResponse.json()
      const summary = activityJson.summary || {}
      activityData = {
        steps: toInteger(summary.steps),
        calories: summary.caloriesOut || null,
        active_calories: summary.activityCalories || null,
        distance: summary.distances && summary.distances.length > 0 
          ? summary.distances[0].distance || null 
          : null
      }
    }
    
    // Combine all data
    const fitbitData = {
      ...sleepData,
      ...hrData,
      ...hrvData,
      ...activityData
    }
    
    // Save to database
    await saveFitbitDaily(userId, targetDate, fitbitData)
    
    return { 
      synced: true, 
      date: targetDate,
      data: fitbitData
    }
    
  } catch (error: any) {
    logError('Error syncing Fitbit data', error)
    
    // If 401, token might be invalid
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('Fitbit authorization expired. Please reconnect your account.')
    }
    
    throw new Error(`Failed to sync Fitbit data: ${error.message}`)
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
  
  const merged = {
    user_id: userId,
    date: targetDate,
    resting_heart_rate: toNumber(fitbitData?.resting_heart_rate) ?? existingMetrics?.resting_heart_rate ?? null,
    hrv: toNumber(fitbitData?.hrv) ?? existingMetrics?.hrv ?? null,
    body_temp: toNumber(fitbitData?.body_temp) ?? existingMetrics?.body_temp ?? null,
    sleep_score: (() => {
      const eff = fitbitData?.source_data?.sleep_efficiency != null ? toNumber(fitbitData.source_data.sleep_efficiency) : null
      if (eff != null) return Math.round(eff)
      return existingMetrics?.sleep_score ?? null
    })(),
    sleep_duration: toNumber(fitbitData?.sleep_duration) ?? existingMetrics?.sleep_duration ?? null,
    deep_sleep: existingMetrics?.deep_sleep ?? null,
    rem_sleep: existingMetrics?.rem_sleep ?? null,
    light_sleep: existingMetrics?.light_sleep ?? null,
    calories_burned: toNumber(fitbitData?.calories_burned) ?? existingMetrics?.calories_burned ?? null,
    steps: toInteger(fitbitData?.steps) ?? existingMetrics?.steps ?? null,
    weight: existingMetrics?.weight ?? null,
    body_fat_percentage: existingMetrics?.body_fat_percentage ?? null,
    source_provider: fitbitData ? 'fitbit' : existingMetrics?.source_provider ?? 'manual',
    source_data: {
      ...(fitbitData?.source_data || {}),
      ...(existingMetrics?.source_data || {})
    },
    updated_at: new Date().toISOString()
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

