import { supabase } from './supabase'
import { getTodayEST } from '../utils/dateUtils'
import { toInteger, toNumber } from '../utils/numberUtils'
import { logError, logDebug } from '../utils/logger'

// Ensure logDebug is always available (fallback for build issues)
const safeLogDebug = logDebug || (() => {})

/**
 * Wearables OAuth and Data Sync
 * Supports: Oura, Fitbit, Apple Health, Garmin, Whoop
 */

// ============ CONNECTED ACCOUNTS ============

export async function saveConnectedAccount(userId, provider, tokens) {
  const { data, error } = await supabase
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

export async function getConnectedAccount(userId, provider) {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getAllConnectedAccounts(userId) {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select('*')
    .eq('user_id', userId)
  
  if (error) throw error
  return data || []
}

export async function disconnectAccount(userId, provider) {
  const { error } = await supabase
    .from('connected_accounts')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
  
  if (error) throw error
}

/**
 * Connect Oura using Personal Access Token (PAT)
 * ⚠️ DEVELOPMENT/TESTING ONLY - NOT FOR PRODUCTION USE
 * 
 * PATs are not compliant with industry standards for production:
 * - Long-lived tokens (security risk)
 * - No automatic refresh
 * - Manual token management required
 * - Not scalable for thousands of users
 * 
 * For production, OAuth 2.0 is required (industry standard, GDPR/CCPA compliant)
 */
export async function connectOuraWithPAT(userId, personalAccessToken) {
  // Only allow in development mode
  if (import.meta.env.PROD) {
    throw new Error('Personal Access Tokens are not allowed in production. OAuth 2.0 is required for compliance.')
  }
  if (!userId || !personalAccessToken) {
    throw new Error('User ID and Personal Access Token are required')
  }

  // Test the token by making a simple API call
  try {
    const testResponse = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
      headers: {
        'Authorization': `Bearer ${personalAccessToken}`
      }
    })

    if (!testResponse.ok) {
      if (testResponse.status === 401) {
        throw new Error('Invalid Personal Access Token. Please check your token.')
      }
      throw new Error(`Oura API error: ${testResponse.statusText}`)
    }

    // Token is valid, save it
    // PATs don't expire, so we set a far future date
    const farFuture = new Date()
    farFuture.setFullYear(farFuture.getFullYear() + 10) // 10 years from now

    return await saveConnectedAccount(userId, 'oura', {
      access_token: personalAccessToken,
      refresh_token: null, // PATs don't have refresh tokens
      expires_at: farFuture.toISOString(),
      token_type: 'Bearer',
      scope: 'personal daily session'
    })
  } catch (error) {
    logError('Error connecting Oura with PAT', error)
    throw error
  }
}

// ============ OURA INTEGRATION ============

export async function saveOuraDaily(userId, date, data) {
  // Save to health_metrics table (unified table)
  const healthMetricsData = {
    user_id: userId,
    date: date,
    resting_heart_rate: toNumber(data.resting_heart_rate),
    hrv: toNumber(data.hrv),
    body_temp: toNumber(data.body_temp),
    sleep_score: toNumber(data.sleep_score),
    sleep_duration: toNumber(data.sleep_duration), // Already in minutes from syncOuraData
    deep_sleep: toNumber(data.deep_sleep), // Already in minutes
    rem_sleep: toNumber(data.rem_sleep), // Already in minutes
    light_sleep: toNumber(data.light_sleep), // Already in minutes
    calories_burned: toNumber(data.calories_burned || data.calories),
    steps: toInteger(data.steps), // INTEGER column - must be whole number
    source_provider: 'oura',
    source_data: data.source_data || {
      activity_score: data.activity_score || null,
      readiness_score: data.readiness_score || null,
      recovery_index: data.recovery_index || null,
      sleep_efficiency: data.sleep_efficiency || null,
      sleep_latency: data.sleep_latency || null,
      active_calories: data.active_calories || null,
      total_calories: data.total_calories || null,
      average_heart_rate: data.average_heart_rate || null,
      max_heart_rate: data.max_heart_rate || null
    },
    updated_at: new Date().toISOString()
  }

  const { data: result, error } = await supabase
    .from('health_metrics')
    .upsert(healthMetricsData, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) throw error
  
  // Also save to oura_daily for backward compatibility (deprecated but kept)
  try {
    await supabase
      .from('oura_daily')
      .upsert({
        user_id: userId,
        date: date,
        hrv: data.hrv || null,
        resting_heart_rate: data.resting_heart_rate || null,
        body_temp: data.body_temp || null,
        sleep_score: data.sleep_score || null,
        sleep_duration: data.sleep_duration || null,
        sleep_efficiency: data.sleep_efficiency || null,
        total_sleep: data.total_sleep || null,
        deep_sleep: data.deep_sleep || null,
        rem_sleep: data.rem_sleep || null,
        light_sleep: data.light_sleep || null,
        activity_score: data.activity_score || null,
        readiness_score: data.readiness_score || null,
        calories: data.calories || null,
        steps: toInteger(data.steps),
        active_calories: data.active_calories || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })
  } catch (err) {
    // Ignore errors on deprecated table
    safeLogDebug('Error saving to oura_daily (deprecated)', err)
  }
  
  return result
}

export async function getOuraDaily(userId, date) {
  // Get from health_metrics (primary source)
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('source_provider', 'oura')
    .maybeSingle()
  
  if (error && error.code !== 'PGRST116') throw error
  
  // If not found in health_metrics, try deprecated oura_daily table
  if (!data) {
    const { data: legacyData, error: legacyError } = await supabase
      .from('oura_daily')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()
    
    if (legacyError && legacyError.code !== 'PGRST116') throw legacyError
    return legacyData
  }
  
  return data
}

/**
 * Sync Oura data for a date
 * Uses serverless function to avoid CORS issues
 */
export async function syncOuraData(userId, date = null) {
  const targetDate = date || getTodayEST()
  const account = await getConnectedAccount(userId, 'oura')
  
  if (!account) {
    throw new Error('Oura account not connected')
  }

  try {
    // Use serverless function to proxy Oura API calls (avoids CORS)
    const response = await fetch('/api/oura/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userId,
        date: targetDate
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `Failed to sync Oura data: ${response.statusText}`)
    }

    const result = await response.json()

    console.log('Oura sync response:', result)

    if (!result.success) {
      throw new Error(result.message || 'Oura sync failed')
    }

    console.log('Oura sync successful, data received:', result.data)
    console.log('Oura sync saved to DB:', result.saved)

    return {
      synced: true,
      date: result.date,
      data: result.data
    }

  } catch (error) {
    logError('Error syncing Oura data', error)
    throw error
  }
}

// ============ FITBIT INTEGRATION ============

export async function saveFitbitDaily(userId, date, data) {
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
    console.error('Error saving Fitbit daily data to health_metrics:', error)
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

export async function getFitbitDaily(userId, date) {
  // Get from health_metrics (primary source)
  const { data, error } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .eq('source_provider', 'fitbit')
    .maybeSingle()
  
  if (error) {
    console.error('Error getting Fitbit daily data from health_metrics:', error)
    // Try deprecated table as fallback
    const { data: legacyData, error: legacyError } = await supabase
      .from('fitbit_daily')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle()
    
    if (legacyError) {
      console.error('Error getting Fitbit daily data from fitbit_daily:', legacyError)
      return null
    }
    return legacyData
  }
  
  return data
}

/**
 * Get most recent Fitbit data
 */
export async function getMostRecentFitbitData(userId) {
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
async function refreshFitbitToken(userId, account) {
  const expiresAt = account.expires_at ? new Date(account.expires_at) : null
  const now = new Date()
  
  // Refresh if expired or expires within 5 minutes
  if (!expiresAt || expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
    try {
      const response = await fetch('/api/fitbit/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          refreshToken: account.refresh_token
        })
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
    } catch (error) {
      console.error('Error refreshing Fitbit token:', error)
      throw new Error('Token refresh failed. Please reconnect your Fitbit account.')
    }
  }
  
  return account.access_token
}

/**
 * Sync Fitbit data for a date
 * Uses serverless function to avoid CORS issues
 */
export async function syncFitbitData(userId, date = null) {
  const targetDate = date || getTodayEST()
  
  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    const authToken = session?.access_token || ''
    
    // Use serverless function to sync Fitbit data
    const response = await fetch('/api/fitbit/sync', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        userId,
        date: targetDate
      })
    })
    
    if (!response.ok) {
      let errorData = {}
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
    
    const result = await response.json()
    
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
    
  } catch (error) {
    // Re-throw with better message
    const errorMsg = typeof error?.message === 'string' ? error.message : String(error || 'Unknown error')
    if (errorMsg.includes('authorization') || errorMsg.includes('reconnect')) {
      throw error // Already has good message
    }
    
    throw new Error(`Failed to sync Fitbit data: ${errorMsg}`)
  }
}

// Legacy function - kept for backwards compatibility but now uses serverless function
async function syncFitbitDataDirect(userId, date = null) {
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
            .map(entry => entry.value?.dailyRmssd || entry.value?.rmssd)
            .filter(v => v != null)
          
          if (hrvValues.length > 0) {
            const avgHRV = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
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
    
  } catch (error) {
    logError('Error syncing Fitbit data', error)
    
    // If 401, token might be invalid
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('Fitbit authorization expired. Please reconnect your account.')
    }
    
    throw new Error(`Failed to sync Fitbit data: ${error.message}`)
  }
}

// ============ APPLE HEALTH INTEGRATION ============

/**
 * Apple Health requires HealthKit on iOS or Health app sync
 * This is a placeholder for the integration
 */
export async function syncAppleHealthData(userId, date = null) {
  const targetDate = date || getTodayEST()
  // Apple Health integration would use HealthKit JS or native bridge
  return { synced: true, date: targetDate }
}

// ============ GARMIN INTEGRATION ============

export async function syncGarminData(userId, date = null) {
  const targetDate = date || getTodayEST()
  const account = await getConnectedAccount(userId, 'garmin')
  
  if (!account) {
    throw new Error('Garmin account not connected')
  }
  
  // In production, call Garmin Connect API
  return { synced: true, date: targetDate }
}

// ============ WHOOP INTEGRATION ============

export async function syncWhoopData(userId, date = null) {
  const targetDate = date || getTodayEST()
  const account = await getConnectedAccount(userId, 'whoop')
  
  if (!account) {
    throw new Error('Whoop account not connected')
  }
  
  // In production, call Whoop API
  return { synced: true, date: targetDate }
}

// ============ UNIFIED SYNC ============

/**
 * Sync all connected wearables for today
 */
export async function syncAllWearables(userId) {
  const results = []
  const accounts = await getAllConnectedAccounts(userId)
  
  for (const account of accounts) {
    try {
      let result
      switch (account.provider) {
        case 'oura':
          result = await syncOuraData(userId)
          break
        case 'fitbit':
          result = await syncFitbitData(userId)
          break
        case 'apple':
          result = await syncAppleHealthData(userId)
          break
        case 'garmin':
          result = await syncGarminData(userId)
          break
        case 'whoop':
          result = await syncWhoopData(userId)
          break
        default:
          continue
      }
      results.push({ provider: account.provider, ...result })
    } catch (error) {
      logError(`Error syncing ${account.provider}`, error)
      results.push({ provider: account.provider, error: error.message })
    }
  }
  
  return results
}

/**
 * Merge wearable data into health_metrics table
 * This function now merges data from multiple sources into the unified health_metrics table
 */
export async function mergeWearableDataToMetrics(userId, date = null) {
  const targetDate = date || getTodayEST()
  
  // Get all wearable data for the date from health_metrics
  const { data: existingMetrics, error: fetchError } = await supabase
    .from('health_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('date', targetDate)
    .maybeSingle()
  
  // Get source-specific data
  const ouraData = await getOuraDaily(userId, targetDate)
  const fitbitData = await getFitbitDaily(userId, targetDate)
  
  // Merge data (prefer Oura, fallback to Fitbit, preserve existing manual entries)
  const merged = {
    user_id: userId,
    date: targetDate,
    resting_heart_rate: toNumber(ouraData?.resting_heart_rate) ?? toNumber(fitbitData?.resting_heart_rate) ?? existingMetrics?.resting_heart_rate ?? null,
    hrv: toNumber(ouraData?.hrv) ?? toNumber(fitbitData?.hrv) ?? existingMetrics?.hrv ?? null,
    body_temp: toNumber(ouraData?.body_temp) ?? toNumber(fitbitData?.body_temp) ?? existingMetrics?.body_temp ?? null,
    sleep_score: toNumber(ouraData?.sleep_score) ?? (fitbitData?.source_data?.sleep_efficiency != null ? Math.round(toNumber(fitbitData.source_data.sleep_efficiency)) : null) ?? existingMetrics?.sleep_score ?? null,
    sleep_duration: toNumber(ouraData?.sleep_duration) ?? toNumber(fitbitData?.sleep_duration) ?? existingMetrics?.sleep_duration ?? null,
    deep_sleep: toNumber(ouraData?.deep_sleep) ?? existingMetrics?.deep_sleep ?? null,
    rem_sleep: toNumber(ouraData?.rem_sleep) ?? existingMetrics?.rem_sleep ?? null,
    light_sleep: toNumber(ouraData?.light_sleep) ?? existingMetrics?.light_sleep ?? null,
    calories_burned: toNumber(ouraData?.calories_burned) ?? toNumber(fitbitData?.calories_burned) ?? existingMetrics?.calories_burned ?? null,
    steps: toInteger(ouraData?.steps) ?? toInteger(fitbitData?.steps) ?? existingMetrics?.steps ?? null,
    // Preserve manual metrics
    weight: existingMetrics?.weight ?? null,
    body_fat_percentage: existingMetrics?.body_fat_percentage ?? null,
    meals: existingMetrics?.meals ?? null,
    macros: existingMetrics?.macros ?? null,
    water: existingMetrics?.water ?? null,
    calories_consumed: existingMetrics?.calories_consumed ?? null,
    // Determine source provider
    source_provider: (ouraData && fitbitData) ? 'merged' : (ouraData ? 'oura' : (fitbitData ? 'fitbit' : existingMetrics?.source_provider ?? 'manual')),
    source_data: {
      ...(ouraData?.source_data || {}),
      ...(fitbitData?.source_data || {}),
      ...(existingMetrics?.source_data || {})
    },
    updated_at: new Date().toISOString()
  }
  
  // Only update if we have at least one metric
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

