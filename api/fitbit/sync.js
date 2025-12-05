/**
 * Fitbit Data Sync Handler
 * Proxies Fitbit API calls to avoid CORS issues
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' })
  }

  const { userId, date } = req.body

  if (!userId || !date) {
    return res.status(400).json({ message: 'Missing userId or date' })
  }

  try {
    // Get Fitbit account from Supabase
    const { createClient } = await import('@supabase/supabase-js')
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ 
        message: 'Server configuration error',
        error: 'Missing Supabase credentials' 
      })
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Get connected account
    const { data: account, error: accountError } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', 'fitbit')
      .single()

    if (accountError || !account) {
      return res.status(404).json({ message: 'Fitbit account not connected' })
    }

    // Check if token needs refresh (refresh if expires within 10 minutes)
    const expiresAt = account.expires_at ? new Date(account.expires_at) : null
    const now = new Date()
    let accessToken = account.access_token
    let tokenRefreshed = false

    if (!expiresAt || expiresAt <= new Date(now.getTime() + 10 * 60 * 1000)) {
      // Refresh token proactively
      try {
        const tokenResponse = await fetch('https://api.fitbit.com/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${Buffer.from(
              `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`
            ).toString('base64')}`
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: account.refresh_token
          })
        })

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json()
          accessToken = tokenData.access_token
          tokenRefreshed = true
          
          // Update tokens in database
          const newExpiresAt = new Date()
          newExpiresAt.setSeconds(newExpiresAt.getSeconds() + (tokenData.expires_in || 28800))
          
          const { error: updateError } = await supabase
            .from('connected_accounts')
            .update({
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_at: newExpiresAt.toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('provider', 'fitbit')
          
          if (updateError) {
            console.error('Error updating refreshed token:', updateError)
          }
        } else {
          // If refresh fails, try to use existing token but log warning
          const errorData = await tokenResponse.json().catch(() => ({}))
          console.warn('Token refresh failed, using existing token:', errorData)
        }
      } catch (refreshError) {
        console.error('Error during token refresh:', refreshError)
        // Continue with existing token
      }
    }

    // Fetch Fitbit data
    const fitbitData = {}

    // Fetch sleep data
    try {
      const sleepResponse = await fetch(
        `https://api.fitbit.com/1.2/user/-/sleep/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (sleepResponse.ok) {
        const sleepJson = await sleepResponse.json()
        if (sleepJson.sleep && sleepJson.sleep.length > 0) {
          const sleep = sleepJson.sleep[0]
          fitbitData.sleep_duration = sleep.minutesAsleep || null
          fitbitData.sleep_efficiency = sleep.efficiency || null
        }
      }
    } catch (e) {
      console.error('Error fetching sleep:', e)
    }

    // Fetch heart rate data
    try {
      const hrResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrResponse.ok) {
        const hrJson = await hrResponse.json()
        if (hrJson['activities-heart'] && hrJson['activities-heart'].length > 0) {
          const heartData = hrJson['activities-heart'][0].value
          fitbitData.resting_heart_rate = heartData?.restingHeartRate || null
        }
      }
    } catch (e) {
      console.error('Error fetching heart rate:', e)
    }

    // Fetch HRV data
    try {
      const hrvResponse = await fetch(
        `https://api.fitbit.com/1/user/-/hrv/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrvResponse.ok) {
        const hrvJson = await hrvResponse.json()
        if (hrvJson.hrv && hrvJson.hrv.length > 0) {
          const hrvValues = hrvJson.hrv
            .map(entry => entry.value?.dailyRmssd || entry.value?.rmssd)
            .filter(v => v != null)
          
          if (hrvValues.length > 0) {
            const avgHRV = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length
            fitbitData.hrv = avgHRV
          }
        }
      }
    } catch (e) {
      console.error('Error fetching HRV:', e)
    }

    // Fetch activity data
    try {
      const activityResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (activityResponse.ok) {
        const activityJson = await activityResponse.json()
        const summary = activityJson.summary || {}
        fitbitData.steps = summary.steps || null
        fitbitData.calories = summary.caloriesOut || null
        fitbitData.active_calories = summary.activityCalories || null
        fitbitData.distance = summary.distances && summary.distances.length > 0 
          ? summary.distances[0].distance || null 
          : null
        fitbitData.floors = summary.floors || null
        
        // Additional activity metrics
        fitbitData.sedentary_minutes = summary.sedentaryMinutes || null
        fitbitData.lightly_active_minutes = summary.lightlyActiveMinutes || null
        fitbitData.fairly_active_minutes = summary.fairlyActiveMinutes || null
        fitbitData.very_active_minutes = summary.veryActiveMinutes || null
        fitbitData.marginal_calories = summary.marginalCalories || null
      } else if (activityResponse.status === 401) {
        // Token expired, try one more refresh
        throw new Error('Token expired during activity fetch')
      }
    } catch (e) {
      console.error('Error fetching activity:', e)
      if (e.message === 'Token expired during activity fetch' && !tokenRefreshed) {
        // Retry with token refresh
        throw new Error('Authorization expired. Please reconnect your Fitbit account.')
      }
    }
    
    // Fetch body composition (weight, BMI, fat) if available
    try {
      const bodyResponse = await fetch(
        `https://api.fitbit.com/1/user/-/body/log/weight/date/${date}.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (bodyResponse.ok) {
        const bodyJson = await bodyResponse.json()
        if (bodyJson.weight && bodyJson.weight.length > 0) {
          const latestWeight = bodyJson.weight[bodyJson.weight.length - 1]
          fitbitData.weight = latestWeight.weight || null
          fitbitData.bmi = latestWeight.bmi || null
          fitbitData.fat = latestWeight.fat || null
        }
      }
    } catch (e) {
      // Body composition is optional, don't fail if unavailable
      console.log('Body composition data not available:', e.message)
    }
    
    // Fetch heart rate zones if available
    try {
      const hrZonesResponse = await fetch(
        `https://api.fitbit.com/1/user/-/activities/heart/date/${date}/1d/1min.json`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        }
      )
      
      if (hrZonesResponse.ok) {
        const hrZonesJson = await hrZonesResponse.json()
        if (hrZonesJson['activities-heart-intraday']?.dataset) {
          const dataset = hrZonesJson['activities-heart-intraday'].dataset
          if (dataset.length > 0) {
            // Calculate average heart rate for the day
            const avgHR = dataset.reduce((sum, entry) => sum + (entry.value || 0), 0) / dataset.length
            fitbitData.average_heart_rate = Math.round(avgHR) || null
          }
        }
      }
    } catch (e) {
      // Heart rate zones are optional
      console.log('Heart rate zones data not available:', e.message)
    }

    // Save to fitbit_daily table - ensure all stats are saved
    const { error: saveError } = await supabase
      .from('fitbit_daily')
      .upsert({
        user_id: userId,
        date: date,
        hrv: fitbitData.hrv || null,
        resting_heart_rate: fitbitData.resting_heart_rate || null,
        average_heart_rate: fitbitData.average_heart_rate || null,
        sleep_duration: fitbitData.sleep_duration || null,
        sleep_efficiency: fitbitData.sleep_efficiency || null,
        steps: fitbitData.steps || null,
        calories: fitbitData.calories || null,
        active_calories: fitbitData.active_calories || null,
        marginal_calories: fitbitData.marginal_calories || null,
        distance: fitbitData.distance || null,
        floors: fitbitData.floors || null,
        sedentary_minutes: fitbitData.sedentary_minutes || null,
        lightly_active_minutes: fitbitData.lightly_active_minutes || null,
        fairly_active_minutes: fitbitData.fairly_active_minutes || null,
        very_active_minutes: fitbitData.very_active_minutes || null,
        weight: fitbitData.weight || null,
        bmi: fitbitData.bmi || null,
        fat: fitbitData.fat || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,date' })

    if (saveError) {
      console.error('Error saving Fitbit data:', saveError)
      return res.status(500).json({ 
        message: 'Failed to save data',
        error: saveError 
      })
    }

    // Also merge into daily_metrics for use in workout page
    try {
      const merged = {
        hrv: fitbitData.hrv || null,
        sleep_time: fitbitData.sleep_duration || null,
        sleep_score: fitbitData.sleep_efficiency ? Math.round(fitbitData.sleep_efficiency) : null,
        steps: fitbitData.steps || null,
        calories: fitbitData.calories || fitbitData.active_calories || null,
        weight: null
      }
      
      // Update daily_metrics - only if we have data
      if (merged.hrv || merged.sleep_time || merged.steps || merged.calories) {
        const { error: metricsError } = await supabase
          .from('daily_metrics')
          .upsert({
            user_id: userId,
            date: date,
            sleep_score: merged.sleep_score,
            sleep_time: merged.sleep_time,
            hrv: merged.hrv,
            steps: merged.steps,
            calories: merged.calories,
            weight: null
          }, { onConflict: 'user_id,date' })
        
        if (metricsError) {
          console.error('Error merging to daily_metrics:', metricsError)
        }
      }
    } catch (mergeError) {
      console.error('Error merging wearable data:', mergeError)
      // Don't fail the request if merge fails
    }

    return res.status(200).json({
      synced: true,
      date: date,
      data: fitbitData
    })

  } catch (error) {
    console.error('Fitbit sync error:', {
      userId,
      date,
      error: error.message,
      stack: error.stack
    })
    
    let statusCode = 500
    let errorMessage = 'Failed to sync Fitbit data'
    
    if (error.message?.includes('authorization') || error.message?.includes('reconnect') || error.message?.includes('401') || error.message?.includes('403')) {
      statusCode = 401
      errorMessage = 'Fitbit authorization expired. Please reconnect your account.'
    } else if (error.message?.includes('not connected') || error.message?.includes('404') || error.message?.includes('not found')) {
      statusCode = 404
      errorMessage = 'Fitbit account not connected'
    } else if (error.message) {
      errorMessage = error.message
    }
    
    return res.status(statusCode).json({ 
      error: errorMessage,
      success: false,
      message: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}

