import { supabase } from './supabase'
import { getTodayEST } from '../utils/dateUtils'

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

// ============ OURA INTEGRATION ============

export async function saveOuraDaily(userId, date, data) {
  const { data: result, error } = await supabase
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
      steps: data.steps || null,
      active_calories: data.active_calories || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) throw error
  return result
}

export async function getOuraDaily(userId, date) {
  const { data, error } = await supabase
    .from('oura_daily')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  
  if (error && error.code !== 'PGRST116') throw error
  return data
}

/**
 * Sync Oura data for a date
 * This would call Oura API in production
 */
export async function syncOuraData(userId, date = null) {
  const targetDate = date || getTodayEST()
  const account = await getConnectedAccount(userId, 'oura')
  
  if (!account) {
    throw new Error('Oura account not connected')
  }
  
  // In production, this would call Oura API:
  // const response = await fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${date}&end_date=${date}`, {
  //   headers: { 'Authorization': `Bearer ${account.access_token}` }
  // })
  // const ouraData = await response.json()
  
  // For now, return mock structure
  // In production, parse Oura API response and save
  return { synced: true, date: targetDate }
}

// ============ FITBIT INTEGRATION ============

export async function saveFitbitDaily(userId, date, data) {
  const { data: result, error } = await supabase
    .from('fitbit_daily')
    .upsert({
      user_id: userId,
      date: date,
      hrv: data.hrv || null,
      resting_heart_rate: data.resting_heart_rate || null,
      average_heart_rate: data.average_heart_rate || null,
      body_temp: data.body_temp || null,
      sleep_duration: data.sleep_duration || null,
      sleep_efficiency: data.sleep_efficiency || null,
      calories: data.calories || null,
      steps: data.steps || null,
      active_calories: data.active_calories || null,
      marginal_calories: data.marginal_calories || null,
      distance: data.distance || null,
      floors: data.floors || null,
      sedentary_minutes: data.sedentary_minutes || null,
      lightly_active_minutes: data.lightly_active_minutes || null,
      fairly_active_minutes: data.fairly_active_minutes || null,
      very_active_minutes: data.very_active_minutes || null,
      weight: data.weight || null,
      bmi: data.bmi || null,
      fat: data.fat || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,date' })
    .select()
    .single()
  
  if (error) throw error
  return result
}

export async function getFitbitDaily(userId, date) {
  const { data, error } = await supabase
    .from('fitbit_daily')
    .select('*')
    .eq('user_id', userId)
    .eq('date', date)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error getting Fitbit daily data:', error)
    throw error
  }
  return data
}

/**
 * Get most recent Fitbit data
 */
export async function getMostRecentFitbitData(userId) {
  const { data, error } = await supabase
    .from('fitbit_daily')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .single()
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error getting most recent Fitbit data:', error)
    return null
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
    
    // Use backend API to sync Fitbit data
    const response = await fetch('/api/input/fitbit/sync', {
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
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || errorData.error || 'Failed to sync Fitbit data')
    }
    
    const result = await response.json()
    
    // Also save directly to fitbit_daily table
    if (result.data) {
      await saveFitbitDaily(userId, targetDate, result.data)
      // Merge into daily_metrics
      await mergeWearableDataToMetrics(userId, targetDate)
    }
    
    return {
      synced: true,
      date: targetDate,
      data: result.data || result
    }
    
  } catch (error) {
    // If 401, token might be invalid
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      throw new Error('Fitbit authorization expired. Please reconnect your account.')
    }
    
    throw new Error(`Failed to sync Fitbit data: ${error.message}`)
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
      console.log('HRV data not available:', hrvError)
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
        steps: summary.steps || null,
        calories: summary.caloriesOut || null,
        active_calories: summary.activityCalories || null,
        distance: summary.distances && summary.distances.length > 0 
          ? summary.distances[0].distance || null 
          : null,
        floors: summary.floors || null
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
    console.error('Error syncing Fitbit data:', error)
    
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
      console.error(`Error syncing ${account.provider}:`, error)
      results.push({ provider: account.provider, error: error.message })
    }
  }
  
  return results
}

/**
 * Merge wearable data into daily_metrics table
 */
export async function mergeWearableDataToMetrics(userId, date = null) {
  const targetDate = date || getTodayEST()
  
  // Get all wearable data for the date
  const ouraData = await getOuraDaily(userId, targetDate)
  const fitbitData = await getFitbitDaily(userId, targetDate)
  
  // Merge into daily_metrics (prefer Oura, fallback to Fitbit)
  // Map Fitbit sleep_duration (minutes) to sleep_time
  // Map Fitbit calories to calories
  const merged = {
    hrv: ouraData?.hrv || fitbitData?.hrv || null,
    sleep_time: ouraData?.total_sleep || fitbitData?.sleep_duration || null, // Both in minutes
    sleep_score: ouraData?.sleep_score || (fitbitData?.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : null),
    steps: ouraData?.steps || fitbitData?.steps || null,
    calories: ouraData?.calories || fitbitData?.calories || fitbitData?.active_calories || null,
    weight: null // Would come from scale or manual entry
  }
  
  // Only update if we have at least one metric
  if (merged.hrv || merged.sleep_time || merged.steps || merged.calories) {
    // Update daily_metrics - map to the format expected by saveMetricsToSupabase
    const { saveMetricsToSupabase } = await import('./supabaseDb')
    await saveMetricsToSupabase(userId, targetDate, {
      sleepScore: merged.sleep_score ? String(merged.sleep_score) : null,
      sleepTime: merged.sleep_time ? String(merged.sleep_time) : null, // Keep as minutes
      hrv: merged.hrv ? String(merged.hrv) : null,
      steps: merged.steps ? String(merged.steps) : null,
      caloriesBurned: merged.calories ? String(merged.calories) : null,
      weight: null
    })
  }
  
  return merged
}

